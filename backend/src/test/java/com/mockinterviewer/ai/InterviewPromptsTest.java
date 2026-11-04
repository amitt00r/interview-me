package com.mockinterviewer.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.mockinterviewer.ai.InterviewAi.PlanSlot;
import com.mockinterviewer.company.Company;
import com.mockinterviewer.interview.Interview;
import com.mockinterviewer.interview.InterviewMode;
import com.mockinterviewer.interview.TurnWhiteboard;
import com.mockinterviewer.interviewer.Interviewer;
import java.util.List;
import org.junit.jupiter.api.Test;

class InterviewPromptsTest {

    private final Company company = new Company("Acme", "Tech", "", "", null);
    private final Interviewer priya = new Interviewer("Priya", "Staff Engineer", 12, "Java", "", null, company);

    @Test
    void planNamesEachSlotsTopicAndKeepsQuestionsOnIt() {
        String task = InterviewPrompts.planTask(
                List.of(new PlanSlot(priya, null), new PlanSlot(priya, "Apache Kafka"), new PlanSlot(priya, "Redis")),
                InterviewMode.ONE_ON_ONE, "an elevator pitch");

        assertThat(task).contains("2. Priya (Staff Engineer, 12 years of experience) - topic: Apache Kafka")
                .contains("3. Priya (Staff Engineer, 12 years of experience) - topic: Redis")
                .contains("squarely about its slot's topic")
                .doesNotContain("Cover a different area each time");
    }

    @Test
    void panelTaskListsTheWholeCompanyByIdAndEachSlotsTopic() {
        org.springframework.test.util.ReflectionTestUtils.setField(priya, "id", 7L);
        String task = InterviewPrompts.panelTask(List.of(priya), InterviewMode.PANEL, 2, 2,
                List.of("Apache Kafka", "Redis"));

        assertThat(task).contains("Choose exactly 2 interviewers")
                .contains("- id 7: Priya (Staff Engineer, 12 years of experience)")
                .contains("  Expertise: Java")
                .contains("1. the candidate's introduction")
                .contains("2. main question - topic: Apache Kafka")
                .contains("3. main question - topic: Redis")
                .contains("Every panelist asks at least one main question");
    }

    @Test
    void planWithoutTopicsLetsClaudeChooseTheAreas() {
        String task = InterviewPrompts.planTask(List.of(new PlanSlot(priya, null), new PlanSlot(priya, null)),
                InterviewMode.ONE_ON_ONE, "an elevator pitch");

        assertThat(task).contains("Cover a different area each time").doesNotContain("topic:");
    }

    @Test
    void setupWrapsTheRoundInTagsAndOnlyRestrictsWhenThereAreTopics() {
        Interview interview = interview();
        interview.defineRound("Round 2", "Trade-offs only.", List.of("Apache Kafka", "Redis"));
        assertThat(InterviewPrompts.setup(interview, 5, 2))
                .contains("<round>\nRound: Round 2\nBrief: Trade-offs only.\nFocus topics: Apache Kafka; Redis\n</round>")
                .contains("restricted to its focus topics");

        interview.defineRound("Round 2", null, List.of());
        assertThat(InterviewPrompts.setup(interview, 5, 2))
                .contains("<round>\nRound: Round 2\n</round>")
                .contains("Shape the main questions around this round.");

        interview.defineRound(null, null, List.of());
        assertThat(InterviewPrompts.setup(interview, 5, 2)).doesNotContain("<round>");
    }

    @Test
    void transcriptShowsOnlyTheLatestDrawingOfEachQuestion() {
        Interview interview = interview();
        var intro = interview.plan(priya, "Introduction", "Tell me about yourself.");
        var design = interview.plan(priya, "System design", "Design a URL shortener on the whiteboard.", true);
        interview.ask(intro).recordAnswer("Hi.", 5, null);
        var main = interview.ask(design);
        main.recordAnswer("Here is v1.", 60, new TurnWhiteboard(new byte[] {1}, null, "Boxes: API"));
        var followUp = interview.askFollowUp(priya, "Add a cache?", true);
        TurnWhiteboard v2 = new TurnWhiteboard(new byte[] {2}, null, "Boxes: API, Cache\nArrows: API -> Cache");
        followUp.recordAnswer("Added Redis.", 30, v2);

        List<InterviewPrompts.Part> parts = InterviewPrompts.transcriptParts(interview.getTurns());

        assertThat(parts).filteredOn(p -> p instanceof InterviewPrompts.Image).singleElement()
                .isEqualTo(new InterviewPrompts.Image(v2));
        String text = InterviewPrompts.transcript(interview.getTurns());
        assertThat(text).contains("(The interviewer asked the candidate to use the whiteboard.)")
                .contains("its latest version is shown further on")
                .contains("<whiteboard_outline>\nBoxes: API, Cache\nArrows: API -> Cache\n</whiteboard_outline>")
                .doesNotContain("Boxes: API\n");
    }

    private Interview interview() {
        return new Interview("Alex", null, null, company, InterviewMode.ONE_ON_ONE, List.of(priya), "cv.txt",
                "text/plain", new byte[0]);
    }
}
