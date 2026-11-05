package com.mockinterviewer.interview;

/** Languages the interview room's code editor supports. */
public enum CodeLanguage {
    JAVA("Java"),
    PYTHON("Python"),
    SQL("SQL");

    private final String label;

    CodeLanguage(String label) {
        this.label = label;
    }

    /** Display name, e.g. "Java". */
    public String label() {
        return label;
    }
}
