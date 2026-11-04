package com.mockinterviewer.interview;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * The whiteboard as it stood when the candidate submitted an answer: a PNG for Claude and the report, the
 * Excalidraw scene so the board can be reopened, and a text outline of its labels and arrows (built by the browser
 * from the scene) that helps Claude read the image. Kept in its own table so loading turns doesn't load images.
 */
@Entity
public class TurnWhiteboard {

    public static final int MAX_PNG_BYTES = 5 * 1024 * 1024;
    public static final int MAX_SCENE_CHARS = 2_000_000;
    public static final int MAX_OUTLINE_CHARS = 10_000;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @JdbcTypeCode(SqlTypes.VARBINARY)
    @Column(nullable = false, length = MAX_PNG_BYTES)
    private byte[] png;

    /** Excalidraw scene JSON ({@code elements} and {@code files}). */
    @Column(columnDefinition = "TEXT")
    private String scene;

    /** "Boxes: ...", "Arrows: A -> B" lines. Candidate-controlled text, so it is sent to Claude as data. */
    @Column(columnDefinition = "TEXT")
    private String outline;

    protected TurnWhiteboard() {
    }

    public TurnWhiteboard(byte[] png, String scene, String outline) {
        this.png = png;
        this.scene = scene;
        this.outline = outline;
    }

    public Long getId() { return id; }
    public byte[] getPng() { return png; }
    public String getScene() { return scene; }
    public String getOutline() { return outline; }
}
