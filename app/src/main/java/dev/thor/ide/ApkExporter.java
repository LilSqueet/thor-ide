package dev.thor.ide;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Turns a project into an installable APK, entirely on the device:
 *
 *   1. take the bundled "player" APK (a tiny dual-screen runtime, assets/player.apk)
 *   2. give it a unique package name + app label by patching the binary AndroidManifest.xml
 *   3. add the project's files under assets/game/
 *   4. JAR-sign it (APK signature scheme v1) with the bundled key
 *
 * Pure java.* only, so it is unit-tested on a desktop JVM as well.
 */
public final class ApkExporter {

    private ApkExporter() {}

    // ------------------------------------------------------------------ public API

    /** Files the project contributes; key = path inside the project (e.g. "media/cat.png"). */
    public static Map<String, File> collectProject(File projectDir) {
        Map<String, File> out = new LinkedHashMap<>();
        walk(projectDir, "", out);
        return out;
    }

    private static void walk(File dir, String prefix, Map<String, File> out) {
        File[] fs = dir.listFiles();
        if (fs == null) return;
        java.util.Arrays.sort(fs);
        for (File f : fs) {
            String p = prefix.isEmpty() ? f.getName() : prefix + "/" + f.getName();
            if (f.isDirectory()) walk(f, p, out);
            else if (!f.getName().endsWith(".tmp")) out.put(p, f);
        }
    }

    /**
     * @param template   the player APK bytes
     * @param gameFiles  project files (path -> file)
     * @param pkg        new package name, e.g. dev.thor.game.my_game
     * @param label      app name shown on the launcher
     * @param keyPkcs8   RSA private key, PKCS#8 DER
     * @param certDer    matching X.509 certificate, DER
     * @param out        destination .apk
     */
    public static void export(byte[] template, Map<String, File> gameFiles, String pkg, String label,
                              byte[] keyPkcs8, byte[] certDer, File out) throws Exception {
        export(template, gameFiles, PLAYER_PACKAGE, PLAYER_LABEL, pkg, label, keyPkcs8, certDer, out);
    }

    public static void export(byte[] template, Map<String, File> gameFiles, String templatePkg, String templateLabel,
                              String pkg, String label, byte[] keyPkcs8, byte[] certDer, File out) throws Exception {
        PrivateKey key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(keyPkcs8));
        X509Certificate cert = (X509Certificate) CertificateFactory.getInstance("X.509")
                .generateCertificate(new ByteArrayInputStream(certDer));

        // 1+2+3: gather entries
        LinkedHashMap<String, byte[]> entries = new LinkedHashMap<>();
        try (ZipInputStream zin = new ZipInputStream(new ByteArrayInputStream(template))) {
            ZipEntry e;
            while ((e = zin.getNextEntry()) != null) {
                if (e.isDirectory()) continue;
                String n = e.getName();
                if (n.startsWith("META-INF/") && (n.endsWith(".SF") || n.endsWith(".RSA") || n.endsWith(".DSA")
                        || n.endsWith(".EC") || n.equals("META-INF/MANIFEST.MF"))) continue;
                byte[] data = readAll(zin);
                if (n.equals("AndroidManifest.xml")) data = BinaryXml.renamePackage(data, templatePkg, pkg, templateLabel, label);
                entries.put(n, data);
            }
        }
        if (!entries.containsKey("AndroidManifest.xml")) throw new IOException("template has no AndroidManifest.xml");
        for (Map.Entry<String, File> g : gameFiles.entrySet()) {
            try (InputStream in = new FileInputStream(g.getValue())) {
                entries.put("assets/game/" + g.getKey(), readAll(in));
            }
        }

        // 4: sign
        byte[] manifest = buildManifest(entries);
        byte[] sf = buildSignatureFile(manifest, entries);
        byte[] rsa = Pkcs7.sign(sf, key, cert);

        File tmp = new File(out.getAbsolutePath() + ".tmp");
        try (ZipOutputStream zout = new ZipOutputStream(new FileOutputStream(tmp))) {
            put(zout, "META-INF/MANIFEST.MF", manifest, false);
            put(zout, "META-INF/CERT.SF", sf, false);
            put(zout, "META-INF/CERT.RSA", rsa, false);
            for (Map.Entry<String, byte[]> e : entries.entrySet()) {
                boolean store = e.getKey().equals("resources.arsc") || isMedia(e.getKey());
                put(zout, e.getKey(), e.getValue(), store);
            }
        }
        if (out.exists()) out.delete();
        if (!tmp.renameTo(out)) throw new IOException("could not write " + out);
    }

    static final String PLAYER_PACKAGE = "dev.thor.player";
    static final String PLAYER_LABEL = "Thor Game";

    private static boolean isMedia(String n) {
        String l = n.toLowerCase();
        return l.endsWith(".png") || l.endsWith(".jpg") || l.endsWith(".jpeg") || l.endsWith(".gif") || l.endsWith(".webp")
                || l.endsWith(".mp4") || l.endsWith(".webm") || l.endsWith(".mp3") || l.endsWith(".ogg") || l.endsWith(".wav");
    }

    private static void put(ZipOutputStream z, String name, byte[] data, boolean store) throws IOException {
        ZipEntry e = new ZipEntry(name);
        e.setTime(1262304000000L); // fixed timestamp, reproducible
        if (store) {
            e.setMethod(ZipEntry.STORED);
            e.setSize(data.length); e.setCompressedSize(data.length);
            CRC32 c = new CRC32(); c.update(data); e.setCrc(c.getValue());
        } else e.setMethod(ZipEntry.DEFLATED);
        z.putNextEntry(e); z.write(data); z.closeEntry();
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[65536]; int r;
        while ((r = in.read(buf)) > 0) bo.write(buf, 0, r);
        return bo.toByteArray();
    }

    /** "My Game!" -> my_game ; always a valid Java identifier chunk. */
    public static String slug(String name) {
        String s = name.toLowerCase().replaceAll("[^a-z0-9]+", "_").replaceAll("^_+|_+$", "");
        if (s.isEmpty()) s = "game";
        if (Character.isDigit(s.charAt(0))) s = "g" + s;
        return s;
    }

    // ------------------------------------------------------------------ JAR signing (v1)

    private static final String CREATED_BY = "Created-By: Thor IDE\r\n";

    /** MANIFEST.MF; each entry section is digested separately for the .SF file. */
    private static byte[] buildManifest(Map<String, byte[]> entries) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        bo.write(("Manifest-Version: 1.0\r\n" + CREATED_BY + "\r\n").getBytes(StandardCharsets.UTF_8));
        for (Map.Entry<String, byte[]> e : entries.entrySet()) bo.write(manifestSection(e.getKey(), digest(e.getValue())));
        return bo.toByteArray();
    }

    private static byte[] buildSignatureFile(byte[] manifest, Map<String, byte[]> entries) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        bo.write(("Signature-Version: 1.0\r\n" + CREATED_BY
                + "SHA-256-Digest-Manifest: " + b64(digest(manifest)) + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        for (Map.Entry<String, byte[]> e : entries.entrySet()) {
            byte[] section = manifestSection(e.getKey(), digest(e.getValue()));
            bo.write(manifestSection(e.getKey(), digest(section)));
        }
        return bo.toByteArray();
    }

    /** One "Name: x\r\nSHA-256-Digest: y\r\n\r\n" section, with 72-byte line wrapping per the JAR spec. */
    private static byte[] manifestSection(String name, byte[] dig) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        writeLine(bo, "Name: " + name);
        writeLine(bo, "SHA-256-Digest: " + b64(dig));
        bo.write('\r'); bo.write('\n');
        return bo.toByteArray();
    }

    private static void writeLine(ByteArrayOutputStream bo, String line) throws IOException {
        byte[] b = line.getBytes(StandardCharsets.UTF_8);
        int i = 0, max = 70; // 72 bytes incl. CRLF
        boolean first = true;
        while (i < b.length) {
            int n = Math.min(first ? max : max - 1, b.length - i);
            if (!first) bo.write(' ');
            bo.write(b, i, n); bo.write('\r'); bo.write('\n');
            i += n; first = false;
        }
    }

    private static byte[] digest(byte[] d) throws Exception { return MessageDigest.getInstance("SHA-256").digest(d); }
    private static String b64(byte[] b) { return Base64.getEncoder().encodeToString(b); }

    // ------------------------------------------------------------------ PKCS#7 / CMS SignedData (detached, no signed attributes)

    static final class Pkcs7 {
        static final byte[] OID_SIGNED_DATA = oid("1.2.840.113549.1.7.2");
        static final byte[] OID_DATA        = oid("1.2.840.113549.1.7.1");
        static final byte[] OID_SHA256      = oid("2.16.840.1.101.3.4.2.1");
        static final byte[] OID_RSA         = oid("1.2.840.113549.1.1.1");

        static byte[] sign(byte[] content, PrivateKey key, X509Certificate cert) throws Exception {
            Signature s = Signature.getInstance("SHA256withRSA");
            s.initSign(key); s.update(content);
            byte[] sig = s.sign();

            byte[] sha256Alg = seq(OID_SHA256, der(0x05, new byte[0]));
            byte[] rsaAlg    = seq(OID_RSA,    der(0x05, new byte[0]));
            byte[] signerInfo = seq(
                    integer(BigInteger.ONE),
                    seq(cert.getIssuerX500Principal().getEncoded(), integer(cert.getSerialNumber())),
                    sha256Alg,
                    rsaAlg,
                    der(0x04, sig));
            byte[] signedData = seq(
                    integer(BigInteger.ONE),
                    der(0x31, sha256Alg),                 // digestAlgorithms SET
                    seq(OID_DATA),                        // encapContentInfo, detached
                    der(0xA0, cert.getEncoded()),         // certificates [0] IMPLICIT
                    der(0x31, signerInfo));               // signerInfos SET
            return seq(OID_SIGNED_DATA, der(0xA0, signedData));
        }

        static byte[] seq(byte[]... parts) throws IOException { return der(0x30, cat(parts)); }
        static byte[] integer(BigInteger v) throws IOException { return der(0x02, v.toByteArray()); }

        static byte[] der(int tag, byte[] body) throws IOException {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            bo.write(tag);
            int n = body.length;
            if (n < 0x80) bo.write(n);
            else if (n < 0x100) { bo.write(0x81); bo.write(n); }
            else if (n < 0x10000) { bo.write(0x82); bo.write(n >> 8); bo.write(n); }
            else { bo.write(0x83); bo.write(n >> 16); bo.write(n >> 8); bo.write(n); }
            bo.write(body);
            return bo.toByteArray();
        }

        static byte[] cat(byte[]... parts) throws IOException {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            for (byte[] p : parts) bo.write(p);
            return bo.toByteArray();
        }

        /** DER-encoded OBJECT IDENTIFIER (tag + length + base-128 arcs). */
        static byte[] oid(String dotted) {
            String[] a = dotted.split("\\.");
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            bo.write(Integer.parseInt(a[0]) * 40 + Integer.parseInt(a[1]));
            for (int i = 2; i < a.length; i++) {
                long v = Long.parseLong(a[i]);
                int shift = 0; while ((v >> (shift + 7)) != 0) shift += 7;
                for (; shift >= 0; shift -= 7) bo.write((int) (((v >> shift) & 0x7F) | (shift > 0 ? 0x80 : 0)));
            }
            try { return der(0x06, bo.toByteArray()); } catch (IOException e) { throw new RuntimeException(e); }
        }
    }

    // ------------------------------------------------------------------ binary AndroidManifest.xml string-pool patching

    static final class BinaryXml {
        /** Replaces exact pool strings oldPkg->newPkg and oldLabel->newLabel, rewriting the string pool chunk. */
        static byte[] renamePackage(byte[] xml, String oldPkg, String newPkg, String oldLabel, String newLabel) throws IOException {
            ByteBuffer b = ByteBuffer.wrap(xml).order(ByteOrder.LITTLE_ENDIAN);
            if (b.getShort(0) != 0x0003) throw new IOException("not a binary XML");
            int xmlHeaderSize = b.getShort(2) & 0xFFFF;
            int poolOff = xmlHeaderSize;
            if (b.getShort(poolOff) != 0x0001) throw new IOException("string pool not first chunk");
            int poolHeader = b.getShort(poolOff + 2) & 0xFFFF;
            int poolSize = b.getInt(poolOff + 4);
            int stringCount = b.getInt(poolOff + 8);
            int styleCount = b.getInt(poolOff + 12);
            int flags = b.getInt(poolOff + 16);
            int stringsStart = b.getInt(poolOff + 20);
            int stylesStart = b.getInt(poolOff + 24);
            if (styleCount != 0) throw new IOException("styled strings not supported");
            if (poolHeader != 28) throw new IOException("unexpected string pool header size " + poolHeader);
            boolean utf8 = (flags & 0x100) != 0;

            List<String> strings = new ArrayList<>();
            for (int i = 0; i < stringCount; i++) {
                int off = poolOff + stringsStart + b.getInt(poolOff + poolHeader + 4 * i);
                strings.add(utf8 ? readUtf8(b, off) : readUtf16(b, off));
            }
            boolean hitPkg = false;
            for (int i = 0; i < strings.size(); i++) {
                if (strings.get(i).equals(oldPkg)) { strings.set(i, newPkg); hitPkg = true; }
                else if (strings.get(i).equals(oldLabel)) strings.set(i, newLabel);
            }
            if (!hitPkg) throw new IOException("package " + oldPkg + " not found in manifest");

            // rebuild pool
            ByteArrayOutputStream data = new ByteArrayOutputStream();
            int[] offs = new int[strings.size()];
            for (int i = 0; i < strings.size(); i++) {
                offs[i] = data.size();
                data.write(utf8 ? encUtf8(strings.get(i)) : encUtf16(strings.get(i)));
            }
            while (data.size() % 4 != 0) data.write(0);
            int newStringsStart = poolHeader + 4 * strings.size();
            int newPoolSize = newStringsStart + data.size();
            ByteBuffer pool = ByteBuffer.allocate(newPoolSize).order(ByteOrder.LITTLE_ENDIAN);
            pool.putShort((short) 0x0001).putShort((short) poolHeader).putInt(newPoolSize)
                .putInt(strings.size()).putInt(0).putInt(flags).putInt(newStringsStart).putInt(0);
            for (int o : offs) pool.putInt(o);
            pool.put(data.toByteArray());

            // splice
            ByteBuffer out = ByteBuffer.allocate(xml.length - poolSize + newPoolSize).order(ByteOrder.LITTLE_ENDIAN);
            out.put(xml, 0, poolOff);
            out.put(pool.array());
            out.put(xml, poolOff + poolSize, xml.length - poolOff - poolSize);
            out.putInt(4, out.capacity()); // outer chunk size
            return out.array();
        }

        static String readUtf16(ByteBuffer b, int off) {
            int n = b.getShort(off) & 0xFFFF; off += 2;
            if ((n & 0x8000) != 0) { n = ((n & 0x7FFF) << 16) | (b.getShort(off) & 0xFFFF); off += 2; }
            byte[] raw = new byte[n * 2];
            for (int i = 0; i < raw.length; i++) raw[i] = b.get(off + i);
            return new String(raw, StandardCharsets.UTF_16LE);
        }
        static String readUtf8(ByteBuffer b, int off) {
            int n = b.get(off) & 0xFF; off++;
            if ((n & 0x80) != 0) off++;                       // utf16 length (skip)
            int m = b.get(off) & 0xFF; off++;
            if ((m & 0x80) != 0) { m = ((m & 0x7F) << 8) | (b.get(off) & 0xFF); off++; }
            byte[] raw = new byte[m];
            for (int i = 0; i < m; i++) raw[i] = b.get(off + i);
            return new String(raw, StandardCharsets.UTF_8);
        }
        static byte[] encUtf16(String s) throws IOException {
            byte[] raw = s.getBytes(StandardCharsets.UTF_16LE);
            int n = raw.length / 2;
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            if (n > 0x7FFF) { int hi = (n >> 16) | 0x8000; bo.write(hi); bo.write(hi >> 8); }
            bo.write(n); bo.write(n >> 8);
            bo.write(raw); bo.write(0); bo.write(0);
            return bo.toByteArray();
        }
        static byte[] encUtf8(String s) throws IOException {
            byte[] raw = s.getBytes(StandardCharsets.UTF_8);
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            writeLen8(bo, s.length()); writeLen8(bo, raw.length);
            bo.write(raw); bo.write(0);
            return bo.toByteArray();
        }
        static void writeLen8(ByteArrayOutputStream bo, int n) {
            if (n > 0x7F) { bo.write((n >> 8) | 0x80); }
            bo.write(n & 0xFF);
        }
    }
}
