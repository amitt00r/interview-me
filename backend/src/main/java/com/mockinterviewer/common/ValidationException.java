package com.mockinterviewer.common;

import java.util.Map;

/** Bad input on several fields at once; {@code errors} maps each field name to its message. */
public class ValidationException extends RuntimeException {

    private final Map<String, String> errors;

    public ValidationException(Map<String, String> errors) {
        super("Please fix the highlighted fields.");
        this.errors = Map.copyOf(errors);
    }

    public Map<String, String> getErrors() {
        return errors;
    }
}
