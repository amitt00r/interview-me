package com.mockinterviewer.assistant;

import com.mockinterviewer.interview.InterviewService.ResumeUpload;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;

/** Plain text of a stored resume (PDFs via PDFBox, text files as UTF-8), for the assistant's resume tools. */
final class ResumeText {

    private ResumeText() {
    }

    static boolean isPdf(ResumeUpload resume) {
        byte[] d = resume.data();
        return d != null && d.length >= 5 && d[0] == '%' && d[1] == 'P' && d[2] == 'D' && d[3] == 'F' && d[4] == '-';
    }

    /** The resume's text; throws IllegalArgumentException (shown to the model) when a PDF can't be read. */
    static String extract(ResumeUpload resume) {
        if (resume.data() == null || resume.data().length == 0) {
            return "";
        }
        if (!isPdf(resume)) {
            return new String(resume.data(), StandardCharsets.UTF_8);
        }
        try (PDDocument pdf = Loader.loadPDF(resume.data())) {
            String text = new PDFTextStripper().getText(pdf).strip();
            if (text.isEmpty()) {
                throw new IllegalArgumentException("The resume " + resume.fileName() + " is a PDF without text "
                        + "(probably scanned images), so its text can't be read.");
            }
            return text;
        } catch (IOException e) {
            throw new IllegalArgumentException("The resume " + resume.fileName() + " couldn't be read as a PDF.");
        }
    }

    /** Identifies identical files, so a resume reused across interviews is listed once. */
    static String fingerprint(ResumeUpload resume) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(resume.data() == null ? new byte[0] : resume.data());
            return HexFormat.of().formatHex(hash, 0, 8);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
