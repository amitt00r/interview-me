package com.mockinterviewer.interviewer;

import com.mockinterviewer.common.BadRequestException;
import com.mockinterviewer.config.UploadProperties;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Interviewer photos on local disk under {@code <app.uploads.dir>/interviewers}. File names are generated here,
 * never taken from the client, and the type is decided from the file's leading bytes rather than its name.
 */
@Component
public class PhotoStorage {

    static final long MAX_BYTES = 5L * 1024 * 1024;

    public enum ImageType {
        JPEG("jpg", "image/jpeg"),
        PNG("png", "image/png"),
        WEBP("webp", "image/webp"),
        GIF("gif", "image/gif");

        final String extension;
        public final String contentType;

        ImageType(String extension, String contentType) {
            this.extension = extension;
            this.contentType = contentType;
        }

        static ImageType ofFileName(String name) {
            String ext = name.substring(name.lastIndexOf('.') + 1);
            return Arrays.stream(values()).filter(t -> t.extension.equals(ext)).findFirst()
                    .orElseThrow(() -> new IllegalStateException("Unknown photo file " + name));
        }
    }

    private final Path dir;

    public PhotoStorage(UploadProperties props) {
        this.dir = Path.of(props.dir(), "interviewers").toAbsolutePath().normalize();
    }

    /** Validates and writes the image; returns the stored file name. */
    public String save(Long interviewerId, byte[] data) {
        if (data == null || data.length == 0) {
            throw new BadRequestException("Choose an image file to upload.");
        }
        if (data.length > MAX_BYTES) {
            throw new BadRequestException("Photo must be 5 MB or smaller.");
        }
        ImageType type = detect(data);
        if (type == null) {
            throw new BadRequestException("Photo must be a JPEG, PNG, WebP or GIF image.");
        }
        // A fresh name per upload means the photo URL changes too, so browsers never show a cached old photo.
        String name = interviewerId + "-" + UUID.randomUUID().toString().substring(0, 8) + "." + type.extension;
        try {
            Files.createDirectories(dir);
            Files.write(dir.resolve(name), data);
        } catch (IOException e) {
            throw new UncheckedIOException("Could not save photo", e);
        }
        return name;
    }

    public byte[] read(String name) {
        try {
            return Files.readAllBytes(dir.resolve(name));
        } catch (IOException e) {
            throw new UncheckedIOException("Could not read photo " + name, e);
        }
    }

    public boolean exists(String name) {
        return Files.isRegularFile(dir.resolve(name));
    }

    public void delete(String name) {
        if (name == null) {
            return;
        }
        try {
            Files.deleteIfExists(dir.resolve(name));
        } catch (IOException e) {
            throw new UncheckedIOException("Could not delete photo " + name, e);
        }
    }

    static ImageType detect(byte[] b) {
        if (startsWith(b, 0, 0xFF, 0xD8, 0xFF)) {
            return ImageType.JPEG;
        }
        if (startsWith(b, 0, 0x89, 'P', 'N', 'G')) {
            return ImageType.PNG;
        }
        if (startsWith(b, 0, 'G', 'I', 'F', '8')) {
            return ImageType.GIF;
        }
        if (startsWith(b, 0, 'R', 'I', 'F', 'F') && startsWith(b, 8, 'W', 'E', 'B', 'P')) {
            return ImageType.WEBP;
        }
        return null;
    }

    private static boolean startsWith(byte[] data, int offset, int... expected) {
        if (data.length < offset + expected.length) {
            return false;
        }
        for (int i = 0; i < expected.length; i++) {
            if ((data[offset + i] & 0xFF) != expected[i]) {
                return false;
            }
        }
        return true;
    }
}
