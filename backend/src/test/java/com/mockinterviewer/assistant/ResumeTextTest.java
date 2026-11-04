package com.mockinterviewer.assistant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.mockinterviewer.interview.InterviewService.ResumeUpload;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.Test;

class ResumeTextTest {

    @Test
    void readsTextFilesAndPdfs() throws Exception {
        var text = new ResumeUpload("cv.txt", "text/plain", "Alex, Java engineer".getBytes(StandardCharsets.UTF_8));
        assertThat(ResumeText.isPdf(text)).isFalse();
        assertThat(ResumeText.extract(text)).isEqualTo("Alex, Java engineer");

        var pdf = new ResumeUpload("cv.pdf", "application/pdf", pdf("Alex Doe - Staff Engineer, Kafka and Java"));
        assertThat(ResumeText.isPdf(pdf)).isTrue();
        assertThat(ResumeText.extract(pdf)).isEqualTo("Alex Doe - Staff Engineer, Kafka and Java");
        assertThat(ResumeText.fingerprint(pdf)).isEqualTo(ResumeText.fingerprint(pdf)).isNotEqualTo(ResumeText.fingerprint(text));
    }

    @Test
    void explainsUnreadablePdfs() throws Exception {
        var scanned = new ResumeUpload("scan.pdf", "application/pdf", pdf(null));
        assertThat(assertThrows(IllegalArgumentException.class, () -> ResumeText.extract(scanned)).getMessage())
                .contains("without text");
        var broken = new ResumeUpload("bad.pdf", "application/pdf", "%PDF-1.7 not really".getBytes(StandardCharsets.UTF_8));
        assertThat(assertThrows(IllegalArgumentException.class, () -> ResumeText.extract(broken)).getMessage())
                .contains("couldn't be read");
    }

    /** A one-page PDF with {@code line} on it (or an empty page). */
    private static byte[] pdf(String line) throws Exception {
        try (PDDocument doc = new PDDocument()) {
            PDPage page = new PDPage();
            doc.addPage(page);
            if (line != null) {
                try (PDPageContentStream content = new PDPageContentStream(doc, page)) {
                    content.beginText();
                    content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                    content.newLineAtOffset(72, 700);
                    content.showText(line);
                    content.endText();
                }
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            doc.save(out);
            return out.toByteArray();
        }
    }
}
