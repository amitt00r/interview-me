package com.mockinterviewer.interview;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.util.List;
import java.util.stream.Collectors;

/**
 * "Ask AI" coaching stored with a question or follow-up once generated: a model answer and a reading list. Hibernate
 * leaves the embedded field null while both columns are null, i.e. until the candidate asks for it.
 */
@Embeddable
public class StudyGuideNotes {

    @Column(columnDefinition = "TEXT")
    private String modelAnswer;

    /** One "topic\treason" per line, in priority order. */
    @Column(columnDefinition = "TEXT")
    private String studyTopics;

    protected StudyGuideNotes() {
    }

    /** {@code topics} are {topic, reason} pairs. */
    StudyGuideNotes(String modelAnswer, List<String[]> topics) {
        this.modelAnswer = modelAnswer.strip();
        this.studyTopics = topics.stream()
                .map(t -> oneLine(t[0]) + "\t" + oneLine(t[1]))
                .collect(Collectors.joining("\n"));
    }

    public String getModelAnswer() {
        return modelAnswer;
    }

    /** {topic, reason} pairs, in priority order. */
    public List<String[]> getStudyTopics() {
        if (studyTopics == null || studyTopics.isBlank()) {
            return List.of();
        }
        return studyTopics.lines().map(line -> {
            int tab = line.indexOf('\t');
            return tab < 0 ? new String[] {line, ""} : new String[] {line.substring(0, tab), line.substring(tab + 1)};
        }).toList();
    }

    static boolean present(StudyGuideNotes notes) {
        return notes != null && notes.modelAnswer != null;
    }

    private static String oneLine(String s) {
        return s == null ? "" : s.replaceAll("[\\t\\r\\n]+", " ").strip();
    }
}
