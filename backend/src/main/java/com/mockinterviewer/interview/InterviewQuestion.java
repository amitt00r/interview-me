package com.mockinterviewer.interview;

import com.mockinterviewer.interviewer.Interviewer;
import jakarta.persistence.Column;
import jakarta.persistence.Embedded;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;

/**
 * One main question in an interview's plan, written up front when the interview starts. The plan fixes which
 * questions are asked, in what order and by whom; follow-ups are generated live and hang off a planned question
 * through {@link InterviewTurn#getPlannedQuestion()}. Reattempts copy the plan, so they ask the same questions.
 */
@Entity
public class InterviewQuestion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    private Interview interview;

    /** 1-based; position 1 is the candidate's introduction unless the interview skips it ({@code Interview.hasIntroduction}). */
    private int position;

    @ManyToOne(optional = false)
    private Interviewer askedBy;

    /** Short label, e.g. "Introduction" or "System design: rate limiter". Null on backfilled legacy rows. */
    private String topic;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String text;

    /** The candidate is expected to sketch the answer on the whiteboard (e.g. system design). Nullable for ddl-auto. */
    private Boolean whiteboard;

    /** The candidate is expected to write code in this language (the room opens the code editor); null otherwise. */
    @Enumerated(EnumType.STRING)
    @Column(length = 16)
    private CodeLanguage codeLanguage;

    /** "Ask AI" model answer and reading list; null until the candidate asks for it. */
    @Embedded
    private StudyGuideNotes studyGuide;

    protected InterviewQuestion() {
    }

    void recordStudyGuide(StudyGuideNotes notes) {
        this.studyGuide = notes;
    }

    /** The stored guide, if the candidate has asked for one. */
    public StudyGuideNotes getStudyGuide() {
        return StudyGuideNotes.present(studyGuide) ? studyGuide : null;
    }

    InterviewQuestion(Interview interview, int position, Interviewer askedBy, String topic, String text,
            boolean whiteboard, CodeLanguage codeLanguage) {
        this.interview = interview;
        this.position = position;
        this.askedBy = askedBy;
        this.topic = topic;
        this.text = text;
        this.whiteboard = whiteboard;
        this.codeLanguage = codeLanguage;
    }

    public Long getId() { return id; }
    public Interview getInterview() { return interview; }
    public int getPosition() { return position; }
    public Interviewer getAskedBy() { return askedBy; }
    public String getTopic() { return topic; }
    public String getText() { return text; }
    public boolean isWhiteboard() { return Boolean.TRUE.equals(whiteboard); }
    public CodeLanguage getCodeLanguage() { return codeLanguage; }
}
