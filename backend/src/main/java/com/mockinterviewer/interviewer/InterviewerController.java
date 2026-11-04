package com.mockinterviewer.interviewer;

import com.mockinterviewer.interviewer.InterviewerDtos.InterviewerRequest;
import com.mockinterviewer.interviewer.InterviewerDtos.InterviewerResponse;
import com.mockinterviewer.interviewer.InterviewerService.Photo;
import jakarta.validation.Valid;
import java.io.IOException;
import java.time.Duration;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/interviewers")
public class InterviewerController {

    private final InterviewerService service;

    public InterviewerController(InterviewerService service) {
        this.service = service;
    }

    /** All interviewers, or one company's panel with {@code companyId}. */
    @GetMapping
    public List<InterviewerResponse> list(@RequestParam(required = false) Long companyId) {
        return service.list(companyId);
    }

    @GetMapping("/{id}")
    public InterviewerResponse get(@PathVariable Long id) {
        return service.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public InterviewerResponse create(@Valid @RequestBody InterviewerRequest req) {
        return service.create(req);
    }

    @PutMapping("/{id}")
    public InterviewerResponse update(@PathVariable Long id, @Valid @RequestBody InterviewerRequest req) {
        return service.update(id, req);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        service.delete(id);
    }

    /** Uploads or replaces the interviewer's photo. */
    @PostMapping(path = "/{id}/photo", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public InterviewerResponse uploadPhoto(@PathVariable Long id, @RequestPart MultipartFile photo)
            throws IOException {
        return service.uploadPhoto(id, photo.getBytes());
    }

    @GetMapping("/{id}/photo")
    public ResponseEntity<byte[]> photo(@PathVariable Long id) {
        Photo photo = service.photo(id);
        // Safe to cache: a new upload gets a new file name and therefore a new URL.
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(photo.contentType()))
                .cacheControl(CacheControl.maxAge(Duration.ofDays(30)))
                .body(photo.data());
    }

    @DeleteMapping("/{id}/photo")
    public InterviewerResponse removePhoto(@PathVariable Long id) {
        return service.removePhoto(id);
    }
}
