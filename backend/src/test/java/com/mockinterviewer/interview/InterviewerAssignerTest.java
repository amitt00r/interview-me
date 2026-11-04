package com.mockinterviewer.interview;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mockinterviewer.ai.AiOutputs.PanelAssignment;
import com.mockinterviewer.common.BadRequestException;
import com.mockinterviewer.config.AiProperties;
import com.mockinterviewer.interview.InterviewerAssigner.Assignment;
import com.mockinterviewer.interviewer.Interviewer;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class InterviewerAssignerTest {

    private static final AiProperties PROPS = new AiProperties(AiProperties.Provider.ANTHROPIC, 5, 2, 3, null, null);
    private static final Interviewer A = interviewer(1L), B = interviewer(2L), C = interviewer(3L), D = interviewer(4L);
    private static final List<Interviewer> ROSTER = List.of(A, B, C, D);

    private final InterviewerAssigner assigner = new InterviewerAssigner(PROPS, new Random(42));

    @Test
    void honoursAValidChoice() {
        Assignment a = assigner.resolve(choice(List.of(3L, 1L, 4L), List.of(3L, 1L, 1L, 4L, 3L, 4L)),
                ROSTER, InterviewMode.PANEL, 6);

        assertThat(a.panel()).containsExactly(C, A, D);
        assertThat(a.askers()).containsExactly(C, A, A, D, C, D);
    }

    @Test
    void theIntroductionsAskerLeadsThePanel() {
        Assignment a = assigner.resolve(choice(List.of(1L, 2L, 3L), List.of(2L, 1L, 2L, 3L, 1L, 3L)),
                ROSTER, InterviewMode.PANEL, 6);

        assertThat(a.panel()).containsExactly(B, A, C);
    }

    @Test
    void unknownAndRepeatedIdsAreDroppedAndTheShortPanelIsFilledFromTheCompany() {
        Assignment a = assigner.resolve(choice(List.of(99L, 2L, 2L), List.of()), ROSTER, InterviewMode.PANEL, 6);

        assertThat(a.panel()).hasSize(3).doesNotHaveDuplicates().contains(B).isSubsetOf(ROSTER);
        assertThat(a.askers()).hasSize(6).allMatch(a.panel()::contains);
    }

    @Test
    void tooManyPicksAreCutToTheFormatsSize() {
        Assignment a = assigner.resolve(choice(List.of(1L, 2L, 3L, 4L), List.of(1L, 1L, 1L, 1L, 1L, 1L)),
                ROSTER, InterviewMode.ONE_ON_ONE, 6);

        assertThat(a.panel()).containsExactly(A);
        assertThat(a.askers()).containsOnly(A);
    }

    @Test
    void aSlotAskedBySomeoneOffThePanelFallsBackToRotation() {
        Assignment a = assigner.resolve(choice(List.of(1L), List.of(1L, 2L, 1L)), List.of(A, B),
                InterviewMode.ONE_ON_ONE, 3);

        assertThat(a.panel()).containsExactly(A);
        assertThat(a.askers()).containsExactly(A, A, A);
    }

    @Test
    void everyPanelistAsksAtLeastOneMainQuestion() {
        Assignment a = assigner.resolve(choice(List.of(1L, 2L, 3L), List.of(1L, 1L, 1L, 2L, 1L, 2L)),
                ROSTER, InterviewMode.PANEL, 6);

        assertThat(a.askers().subList(1, 6)).contains(A, B, C);
        assertThat(a.askers().getFirst()).isEqualTo(A);
    }

    @Test
    void withoutAChoiceItIsARandomPanelAskingInRotation() {
        Assignment a = assigner.resolve(null, ROSTER, InterviewMode.PANEL, 6);

        assertThat(a.panel()).hasSize(3).doesNotHaveDuplicates().isSubsetOf(ROSTER);
        for (int slot = 0; slot < 6; slot++) {
            assertThat(a.askers().get(slot)).isEqualTo(a.panel().get(slot % 3));
        }
    }

    @Test
    void panelShrinksToCompanySizeButNeedsTwo() {
        assertThat(assigner.resolve(null, List.of(A, B), InterviewMode.PANEL, 6).panel()).hasSize(2);
        assertThat(assigner.panelSize(InterviewMode.PANEL, 10)).isEqualTo(3);
        assertThat(assigner.panelSize(InterviewMode.ONE_ON_ONE, 10)).isEqualTo(1);

        assertThatThrownBy(() -> assigner.resolve(null, List.of(A), InterviewMode.PANEL, 6))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void companyWithoutInterviewersIsRejected() {
        assertThatThrownBy(() -> assigner.resolve(null, List.of(), InterviewMode.ONE_ON_ONE, 6))
                .isInstanceOf(BadRequestException.class);
    }

    private static PanelAssignment choice(List<Long> panel, List<Long> slots) {
        return new PanelAssignment("fit", panel, slots);
    }

    private static Interviewer interviewer(Long id) {
        Interviewer i = new Interviewer("I" + id, "Engineer", 5, "", "", null, null);
        ReflectionTestUtils.setField(i, "id", id);
        return i;
    }
}
