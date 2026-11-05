package com.mockinterviewer.interview;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;

/** Code the candidate wrote in the room's code editor and submitted with an answer. */
@Embeddable
public class TurnCode {

    public static final int MAX_SOURCE_CHARS = 50_000;

    @Enumerated(EnumType.STRING)
    @Column(name = "code_language", length = 16)
    private CodeLanguage language;

    @Column(name = "code_source", columnDefinition = "TEXT")
    private String source;

    protected TurnCode() {
    }

    public TurnCode(CodeLanguage language, String source) {
        this.language = language;
        this.source = source;
    }

    /** Hibernate leaves an all-null embeddable as an instance on some paths; treat that as absent. */
    static boolean present(TurnCode code) {
        return code != null && code.language != null && code.source != null && !code.source.isBlank();
    }

    public CodeLanguage getLanguage() { return language; }
    public String getSource() { return source; }
}
