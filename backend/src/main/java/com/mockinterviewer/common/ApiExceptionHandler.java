package com.mockinterviewer.common;

import com.anthropic.errors.AnthropicException;
import com.anthropic.errors.NoCredentialsException;
import com.anthropic.errors.RateLimitException;
import com.anthropic.errors.UnauthorizedException;
import com.mockinterviewer.ai.AiProvider;
import com.openai.errors.OpenAIException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    private final AiProvider provider;

    public ApiExceptionHandler(AiProvider provider) {
        this.provider = provider;
    }

    @ExceptionHandler(NotFoundException.class)
    ProblemDetail notFound(NotFoundException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, e.getMessage());
    }

    @ExceptionHandler(BadRequestException.class)
    ProblemDetail badRequest(BadRequestException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    /** All field problems at once, as {@code errors: {field: message}}, so a form can mark every field. */
    @ExceptionHandler(ValidationException.class)
    ProblemDetail validation(ValidationException e) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
        problem.setProperty("errors", e.getErrors());
        return problem;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail invalid(MethodArgumentNotValidException e) {
        String detail = e.getBindingResult().getFieldErrors().stream()
                .map(err -> err.getField() + " " + err.getDefaultMessage())
                .reduce((a, b) -> a + "; " + b)
                .orElse("Invalid request");
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, detail);
    }

    @ExceptionHandler({UnauthorizedException.class, NoCredentialsException.class,
            com.openai.errors.UnauthorizedException.class})
    ProblemDetail aiAuth(RuntimeException e) {
        log.error("{} API authentication failed", provider.displayName(), e);
        return aiAuthProblem();
    }

    @ExceptionHandler({RateLimitException.class, com.openai.errors.RateLimitException.class})
    ProblemDetail aiRateLimit(RuntimeException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                "AI service is rate limited. Try again in a moment.");
    }

    @ExceptionHandler({AnthropicException.class, OpenAIException.class})
    ProblemDetail aiFailure(RuntimeException e) {
        log.error("{} API call failed", provider.displayName(), e);
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_GATEWAY,
                "AI service call failed: " + e.getMessage());
    }

    private ProblemDetail aiAuthProblem() {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_GATEWAY,
                "AI service rejected the credentials. Is " + provider.apiKeyVariable() + " set for the backend?");
    }

    @ExceptionHandler(AiResponseException.class)
    ProblemDetail aiResponse(AiResponseException e) {
        log.warn("Unusable AI response: {}", e.getMessage());
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_GATEWAY, e.getMessage());
    }
}
