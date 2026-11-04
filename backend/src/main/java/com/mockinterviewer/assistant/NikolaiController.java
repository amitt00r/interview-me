package com.mockinterviewer.assistant;

import com.mockinterviewer.assistant.NikolaiService.ChatReply;
import com.mockinterviewer.common.BadRequestException;
import com.mockinterviewer.interview.InterviewService.ResumeUpload;
import java.io.IOException;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** Nikolai's chat: one message (plus an optional resume to start interviews with) per request. */
@RestController
@RequestMapping("/api/nikolai")
public class NikolaiController {

    private static final long MAX_RESUME_BYTES = 10L * 1024 * 1024;
    private static final int MAX_MESSAGE_CHARS = 8_000;

    private final NikolaiService nikolai;

    public NikolaiController(NikolaiService nikolai) {
        this.nikolai = nikolai;
    }

    @PostMapping(path = "/chat", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ChatReply chat(@RequestParam(required = false) String conversationId,
            @RequestParam(required = false) String message,
            @RequestPart(required = false) MultipartFile resume) throws IOException {
        if ((message == null || message.isBlank()) && resume == null) {
            throw new BadRequestException("Say something to Nikolai.");
        }
        if (message != null && message.length() > MAX_MESSAGE_CHARS) {
            throw new BadRequestException("That message is too long (max " + MAX_MESSAGE_CHARS + " characters).");
        }
        return nikolai.chat(conversationId, message, resume == null ? null : upload(resume));
    }

    /** Ends a conversation so a new chat starts fresh. */
    @DeleteMapping("/chat/{conversationId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void forget(@PathVariable String conversationId) {
        nikolai.forget(conversationId);
    }

    /** Same rules as the start form: a PDF or a .txt/.md file up to 10 MB. */
    private static ResumeUpload upload(MultipartFile file) throws IOException {
        String name = file.getOriginalFilename() == null ? "resume" : file.getOriginalFilename();
        String lower = name.toLowerCase(Locale.ROOT);
        if (file.getSize() > MAX_RESUME_BYTES) {
            throw new BadRequestException("Resume must be 10 MB or smaller.");
        }
        if (!lower.endsWith(".pdf") && !lower.endsWith(".txt") && !lower.endsWith(".md")) {
            throw new BadRequestException("Resume must be a PDF or a .txt/.md file.");
        }
        String type = lower.endsWith(".pdf") ? "application/pdf" : "text/plain";
        return new ResumeUpload(name, type, file.getBytes());
    }
}
