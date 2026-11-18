package dev.thor.ide;

import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Flat-file project storage. Projects live at
 *   <externalFilesDir>/projects/<name>/...
 * (i.e. Android/data/dev.thor.ide/files/projects on the device), so they can also be
 * reached with a file manager or over USB.
 */
public class ProjectStore {

    private final File root;

    public ProjectStore(File root) {
        this.root = root;
        if (!root.exists()) root.mkdirs();
    }

    public File root() { return root; }

    // ------------------------------------------------------------ projects

    public JSONArray listProjects() {
        JSONArray a = new JSONArray();
        File[] dirs = root.listFiles(File::isDirectory);
        if (dirs == null) return a;
        Arrays.sort(dirs);
        for (File d : dirs) a.put(d.getName());
        return a;
    }

    public String firstProjectName() {
        JSONArray a = listProjects();
        return a.length() == 0 ? null : a.optString(0);
    }

    public boolean createProject(String name, String template, AssetManager assets) {
        if (!validName(name)) return false;
        File dir = new File(root, name);
        if (dir.exists()) return false;
        if (!dir.mkdirs()) return false;
        try {
            copyAssetDir(assets, "templates/" + (template == null || template.isEmpty() ? "blank" : template), dir);
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    public boolean deleteProject(String name) {
        if (!validName(name)) return false;
        return deleteRecursive(new File(root, name));
    }

    /** First launch (or everything deleted): start with one empty adventure so the IDE opens in the block editor. */
    public void ensureSamples(AssetManager assets) {
        if (listProjects().length() > 0) return;
        createProject("my-game", "adventure-blank", assets);
    }

    // ------------------------------------------------------------ files

    public File file(String project, String path) {
        return new File(new File(root, project), path);
    }

    public JSONArray listFiles(String project) {
        JSONArray a = new JSONArray();
        File dir = new File(root, project);
        if (!dir.isDirectory()) return a;
        List<String> out = new ArrayList<>();
        walk(dir, "", out);
        java.util.Collections.sort(out);
        for (String s : out) {
            JSONObject o = new JSONObject();
            try {
                File f = new File(dir, s);
                o.put("path", s);
                o.put("size", f.length());
                o.put("mtime", f.lastModified());
            } catch (Exception ignored) {}
            a.put(o);
        }
        return a;
    }

    private void walk(File dir, String prefix, List<String> out) {
        File[] fs = dir.listFiles();
        if (fs == null) return;
        for (File f : fs) {
            String p = prefix.isEmpty() ? f.getName() : prefix + "/" + f.getName();
            if (f.isDirectory()) walk(f, p, out);
            else out.add(p);
        }
    }

    public String read(String project, String path) {
        File f = file(project, path);
        if (!safe(project, f) || !f.isFile()) return null;
        try (InputStream in = new FileInputStream(f)) {
            return new String(readAll(in), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
    }

    public boolean write(String project, String path, String content) {
        File f = file(project, path);
        if (!safe(project, f)) return false;
        File parent = f.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        File tmp = new File(f.getAbsolutePath() + ".tmp");
        try (OutputStream out = new FileOutputStream(tmp)) {
            out.write(content.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            return false;
        }
        return tmp.renameTo(f);
    }

    /** Copies a stream into the project (used for imported media). */
    public boolean writeStream(String project, String path, InputStream in) {
        File f = file(project, path);
        if (!safe(project, f)) return false;
        File parent = f.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        File tmp = new File(f.getAbsolutePath() + ".tmp");
        try (OutputStream out = new FileOutputStream(tmp)) {
            byte[] buf = new byte[65536]; int r;
            while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
        } catch (IOException e) {
            tmp.delete();
            return false;
        }
        return tmp.renameTo(f);
    }

    public boolean delete(String project, String path) {
        File f = file(project, path);
        if (!safe(project, f)) return false;
        return deleteRecursive(f);
    }

    public boolean rename(String project, String from, String to) {
        File a = file(project, from), b = file(project, to);
        if (!safe(project, a) || !safe(project, b) || b.exists()) return false;
        File parent = b.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        return a.renameTo(b);
    }

    // ------------------------------------------------------------ helpers

    private boolean validName(String name) {
        return name != null && name.matches("[A-Za-z0-9._-]{1,64}") && !name.startsWith(".");
    }

    /** Guard against path traversal out of the project directory. */
    private boolean safe(String project, File f) {
        try {
            String p = new File(root, project).getCanonicalPath() + File.separator;
            return f.getCanonicalPath().startsWith(p) && !f.getName().isEmpty();
        } catch (IOException e) {
            return false;
        }
    }

    private static boolean deleteRecursive(File f) {
        if (f.isDirectory()) {
            File[] fs = f.listFiles();
            if (fs != null) for (File c : fs) deleteRecursive(c);
        }
        return f.delete();
    }

    private static void copyAssetDir(AssetManager assets, String assetPath, File dest) throws IOException {
        String[] names = assets.list(assetPath);
        if (names == null || names.length == 0) {
            // It's a file.
            try (InputStream in = assets.open(assetPath); OutputStream out = new FileOutputStream(dest)) {
                out.write(readAll(in));
            }
            return;
        }
        if (!dest.exists()) dest.mkdirs();
        for (String n : names) copyAssetDir(assets, assetPath + "/" + n, new File(dest, n));
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int r;
        while ((r = in.read(buf)) > 0) bo.write(buf, 0, r);
        return bo.toByteArray();
    }
}
