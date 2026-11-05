package com.mockinterviewer.ai;

import com.fasterxml.jackson.annotation.JsonPropertyDescription;
import com.mockinterviewer.interview.CodeLanguage;
import java.util.List;

/** Structured-output shapes Claude returns. The JSON schema sent to the API is derived from these records. */
public final class AiOutputs {

    private AiOutputs() {
    }

    public record PanelAssignment(
            @JsonPropertyDescription("One to three sentences on why these interviewers fit this candidate and round, and why each slot went to its interviewer. Written first, before the choices.")
            String reasoning,
            @JsonPropertyDescription("Ids of the chosen interviewers, the lead interviewer (who asks the introduction) first. Exactly as many as the format requires, each from the company's list, no repeats.")
            List<Long> panel,
            @JsonPropertyDescription("For each slot in order, the id of the panel interviewer who asks it. Exactly one entry per slot, each id from the chosen panel.")
            List<Long> slotInterviewerIds) {
    }

    public record PlannedQuestion(
            @JsonPropertyDescription("A short topic label for this question, 2-6 words, e.g. \"Introduction\" or \"System design: rate limiter\".")
            String topic,
            @JsonPropertyDescription("The question exactly as the designated interviewer would say it aloud.")
            String question,
            @JsonPropertyDescription("True when the candidate should sketch their answer on the shared whiteboard (system design, architecture, data flow, data models), and the question then asks them to. False for questions answered by talking.")
            boolean whiteboard,
            @JsonPropertyDescription("JAVA, PYTHON or SQL when the candidate should write code or a query in the shared code editor, and the question then asks them to; NONE otherwise. Never together with whiteboard.")
            CodeEditor code) {

        public PlannedQuestion(String topic, String question) {
            this(topic, question, false);
        }

        public PlannedQuestion(String topic, String question, boolean whiteboard) {
            this(topic, question, whiteboard, CodeEditor.NONE);
        }
    }

    /** Whether the candidate answers in the code editor, and in which language. */
    public enum CodeEditor {
        NONE,
        JAVA,
        PYTHON,
        SQL;

        /** The language, or null for NONE (or a missing value). */
        public static CodeLanguage language(CodeEditor choice) {
            return choice == null || choice == NONE ? null : CodeLanguage.valueOf(choice.name());
        }
    }

    public record InterviewPlan(
            @JsonPropertyDescription("One entry per slot, in slot order. Exactly as many entries as there are slots.")
            List<PlannedQuestion> questions) {
    }

    public enum NextAction {
        FOLLOW_UP,
        NEXT_QUESTION,
        END
    }

    public record TurnDecision(
            @JsonPropertyDescription("Score for the candidate's latest answer, 0 (no answer) to 10 (exceptional).")
            int score,
            @JsonPropertyDescription("1-3 sentences of feedback on the latest answer, addressed to the candidate.")
            String feedback,
            @JsonPropertyDescription("What happens next. Must be one of the actions listed as allowed.")
            NextAction nextAction,
            @JsonPropertyDescription("The follow-up question as the interviewer would say it when nextAction is FOLLOW_UP; otherwise an empty string (the next planned question is asked as written).")
            String nextQuestion,
            @JsonPropertyDescription("FOLLOW_UP only: true when the follow-up asks the candidate to draw on the whiteboard or change their existing drawing. Otherwise false.")
            boolean whiteboard,
            @JsonPropertyDescription("FOLLOW_UP only: JAVA, PYTHON or SQL when the follow-up asks the candidate to write or change code in the code editor; NONE otherwise. Never together with whiteboard.")
            CodeEditor code) {

        public TurnDecision(int score, String feedback, NextAction nextAction, String nextQuestion) {
            this(score, feedback, nextAction, nextQuestion, false);
        }

        public TurnDecision(int score, String feedback, NextAction nextAction, String nextQuestion,
                boolean whiteboard) {
            this(score, feedback, nextAction, nextQuestion, whiteboard, CodeEditor.NONE);
        }
    }

    public record StudyTopic(
            @JsonPropertyDescription("A specific concept or skill to study, 2-8 words, e.g. \"Consistent hashing\" or \"STAR method for behavioural answers\".")
            String topic,
            @JsonPropertyDescription("One sentence on why: the gap in the candidate's answer it fixes, or what it would have added.")
            String reason) {
    }

    public record StudyGuide(
            @JsonPropertyDescription("A strong answer to the question, written in the first person as the candidate would say it aloud in the interview.")
            String modelAnswer,
            @JsonPropertyDescription("3-6 topics to read up on, most important first.")
            List<StudyTopic> studyTopics) {
    }

    public record FinalEvaluation(
            @JsonPropertyDescription("Overall interview score from 0 to 100.")
            int overallScore,
            @JsonPropertyDescription("3-5 sentence hiring-committee style summary of the candidate's performance.")
            String summary,
            @JsonPropertyDescription("2-4 specific strengths shown in the interview.")
            List<String> strengths,
            @JsonPropertyDescription("2-4 specific, actionable areas to improve.")
            List<String> improvements) {
    }
}
