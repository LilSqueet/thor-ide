package dev.thor.ide;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/** Serves exported APKs (files/exports/*.apk) to the package installer. Read-only. */
public class ExportProvider extends ContentProvider {
    static final String AUTHORITY = "dev.thor.ide.exports";

    private File fileFor(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("..") || !name.endsWith(".apk")) throw new FileNotFoundException(String.valueOf(uri));
        File f = new File(new File(getContext().getExternalFilesDir(null), "exports"), name);
        if (!f.isFile()) throw new FileNotFoundException(f.getAbsolutePath());
        return f;
    }

    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "application/vnd.android.package-archive"; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] projection, String sel, String[] args, String sort) {
        MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        try { File f = fileFor(uri); c.addRow(new Object[]{f.getName(), f.length()}); } catch (FileNotFoundException ignored) {}
        return c;
    }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String sel, String[] args) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String sel, String[] args) { return 0; }
}
