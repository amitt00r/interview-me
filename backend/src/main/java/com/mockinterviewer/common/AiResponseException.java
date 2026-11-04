package com.mockinterviewer.common;

/** Claude answered, but not with something the interview flow can use (refusal, truncation, empty). */
public class AiResponseException extends RuntimeException {

    public AiResponseException(String message) {
        super(message);
    }
}
