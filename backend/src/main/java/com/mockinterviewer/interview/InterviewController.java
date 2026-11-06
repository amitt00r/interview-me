package com.mockinterviewer.interview;

import com.mockinterviewer.interview.InterviewDtos.AnswerRequest;
import com.mockinterviewer.interview.InterviewDtos.AttemptSummary;
import com.mockinterviewer.interview.InterviewDtos.InterviewDetail;
import com.mockinterviewer.interview.InterviewDtos.InterviewSummary;
import com.mockinterviewer.interview.InterviewDtos.SkipRequest;
import com.mockinterviewer.interview.InterviewDtos.StudyGuideResponse;
import com.mockinterviewer.interview.InterviewService.ResumeUpload;
import com.mockinterviewer.interview.InterviewService.FormatRequest;
import com.mockinterviewer.interview.InterviewService.RoundRequest;
import jakarta.validation.Valid;
import java.io.IOException;
import java.time.Duration;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/interviews")
public class InterviewController {

    private final InterviewService service;

    public InterviewController(InterviewService service) {
        this.service = service;
    }

    /** Past interviews by default; pass {@code status=IN_PROGRESS} to find unfinished sessions. */
    @GetMapping
    public List<InterviewSummary> list(
            @RequestParam(defaultValue = "COMPLETED,ABANDONED") List<InterviewStatus> status) {
        return service.list(status).stream().map(InterviewSummary::from).toList();
    }

    @GetMapping("/{id}")
    public InterviewDetail get(@PathVariable Long id) {
        return InterviewDetail.from(service.get(id));
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public InterviewDetail start(
            // All optional here so the service can check every field and report all problems together.
            @RequestParam(required = false) String candidateName,
            @RequestParam(required = false) String targetRole,
            @RequestParam(required = false) String jobDescription,
            @RequestParam(required = false) Long companyId,
            @RequestParam(required = false) InterviewMode mode,
            @RequestParam(required = false) String roundName,
            @RequestParam(required = false) String roundDescription,
            @RequestParam(required = false) Integer answerPauseSeconds,
            @RequestParam(required = false) RoundType roundType,
            @RequestParam(required = false) Integer questionCount,
            @RequestParam(required = false) Boolean includeIntroduction,
            @RequestPart(required = false) MultipartFile resume,
            WebRequest request) throws IOException {
        // Repeated "topics" parts, in priority order. Read raw: binding a List would split a lone value on commas.
        String[] topicValues = request.getParameterValues("topics");
        List<String> topics = topicValues == null ? List.of() : List.of(topicValues);
        ResumeUpload upload = resume == null ? null
                : new ResumeUpload(resume.getOriginalFilename(), resume.getContentType(), resume.getBytes());
        RoundRequest round = new RoundRequest(roundName, roundDescription, topics);
        FormatRequest format = new FormatRequest(roundType, questionCount, includeIntroduction);
        return InterviewDetail.from(service.start(candidateName, targetRole, jobDescription, companyId, mode, round,
                format, upload, answerPauseSeconds));
    }

    @PostMapping("/{id}/answers")
    public InterviewDetail answer(@PathVariable Long id, @Valid @RequestBody AnswerRequest req) {
        var board = req.whiteboard() == null ? null : new InterviewService.WhiteboardUpload(
                req.whiteboard().png(), req.whiteboard().scene(), req.whiteboard().outline());
        var code = req.code() == null ? null
                : new InterviewService.CodeUpload(req.code().language(), req.code().source());
        return InterviewDetail.from(service.answer(id, req.answer(), req.responseSeconds(), board, code));
    }

    /** The whiteboard a turn's answer was submitted with, as an image. Never changes once stored. */
    @GetMapping(value = "/{id}/turns/{turnId}/whiteboard.png", produces = MediaType.IMAGE_PNG_VALUE)
    public ResponseEntity<byte[]> whiteboardImage(@PathVariable Long id, @PathVariable Long turnId) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePrivate().immutable())
                .body(service.whiteboard(id, turnId).getPng());
    }

    /** The Excalidraw scene (JSON) of a turn's whiteboard, so the room can reopen the board after a reload. */
    @GetMapping(value = "/{id}/turns/{turnId}/whiteboard/scene", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> whiteboardScene(@PathVariable Long id, @PathVariable Long turnId) {
        String scene = service.whiteboard(id, turnId).getScene();
        return scene == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(scene);
    }

    /** Starts a new attempt that asks exactly the same questions as the original interview. */
    @PostMapping("/{id}/reattempt")
    @ResponseStatus(HttpStatus.CREATED)
    public InterviewDetail reattempt(@PathVariable Long id) {
        return InterviewDetail.from(service.reattempt(id));
    }

    @GetMapping("/{id}/attempts")
    public List<AttemptSummary> attempts(@PathVariable Long id) {
        return service.attempts(id).stream().map(AttemptSummary::from).toList();
    }

    @PostMapping("/{id}/skip")
    public InterviewDetail skip(@PathVariable Long id, @Valid @RequestBody(required = false) SkipRequest req) {
        return InterviewDetail.from(service.skip(id, req == null ? null : req.responseSeconds()));
    }

    /** "Ask AI" on a main question of an ended interview: model answer and reading list, generated once then stored. */
    @PostMapping("/{id}/questions/{questionId}/study-guide")
    public StudyGuideResponse studyGuide(@PathVariable Long id, @PathVariable Long questionId) {
        return StudyGuideResponse.from(service.studyGuide(id, questionId));
    }

    /** "Ask AI" on an answered or skipped follow-up of an ended interview. */
    @PostMapping("/{id}/turns/{turnId}/study-guide")
    public StudyGuideResponse followUpStudyGuide(@PathVariable Long id, @PathVariable Long turnId) {
        return StudyGuideResponse.from(service.followUpStudyGuide(id, turnId));
    }

    @PostMapping("/{id}/end")
    public InterviewDetail end(@PathVariable Long id) {
        return InterviewDetail.from(service.end(id));
    }

    @GetMapping("/{id}/resume")
    public ResponseEntity<byte[]> resume(@PathVariable Long id) {
        Interview interview = service.get(id);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(interview.getResumeContentType()))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline()
                        .filename(interview.getResumeFileName() == null ? "resume" : interview.getResumeFileName())
                        .build().toString())
                .body(interview.getResumeData());
    }

    /** Deletes the whole interview, all attempts included, even when {@code id} is a reattempt. */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        service.delete(id);
    }
}
