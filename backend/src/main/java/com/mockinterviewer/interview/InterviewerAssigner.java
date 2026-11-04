package com.mockinterviewer.interview;

import com.mockinterviewer.ai.AiOutputs.PanelAssignment;
import com.mockinterviewer.common.BadRequestException;
import com.mockinterviewer.config.AiProperties;
import com.mockinterviewer.interviewer.Interviewer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Random;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Turns the AI's choice of interviewers ({@link PanelAssignment}, made from the full interview context) into a legal
 * panel and slot assignment. Code owns the structure, the AI owns the judgement: the panel has exactly the size the
 * format needs, uses only the company's interviewers, and every slot is asked by a panelist. Anything illegal or
 * missing is coerced: unknown or repeated ids are dropped, a short panel is filled at random from the rest of the
 * company, a slot without a valid asker falls back to rotation, and in a panel everyone asks at least one main
 * question. With no choice at all (null) this is the old behaviour: a random panel asking in rotation.
 */
@Component
public class InterviewerAssigner {

    private final AiProperties props;
    private final Random random;

    /** The panel (lead first, who asks the introduction) and who asks each slot, slot 1 first. */
    public record Assignment(List<Interviewer> panel, List<Interviewer> askers) {
    }

    @Autowired
    public InterviewerAssigner(AiProperties props) {
        this(props, new Random());
    }

    InterviewerAssigner(AiProperties props, Random random) {
        this.props = props;
        this.random = random;
    }

    /** How many interviewers the format needs from a company with {@code rosterSize} of them. */
    public int panelSize(InterviewMode mode, int rosterSize) {
        return mode == InterviewMode.ONE_ON_ONE ? 1 : Math.min(Math.max(2, props.panelSize()), rosterSize);
    }

    /**
     * @param choice    the AI's choice, or null when it wasn't asked (a single interviewer leaves no choice)
     * @param roster    all of the company's interviewers
     * @param slotCount the introduction plus the main questions
     */
    public Assignment resolve(PanelAssignment choice, List<Interviewer> roster, InterviewMode mode, int slotCount) {
        if (roster.isEmpty()) {
            throw new BadRequestException("This company has no interviewers yet. Add one on its company page.");
        }
        if (mode == InterviewMode.PANEL && roster.size() < 2) {
            throw new BadRequestException(
                    "A panel interview needs at least 2 interviewers. Add another on the company page.");
        }
        int size = panelSize(mode, roster.size());
        Map<Long, Interviewer> byId = new LinkedHashMap<>();
        roster.forEach(i -> byId.put(i.getId(), i));

        // The panel: the AI's valid, distinct picks in its order, topped up at random.
        List<Interviewer> panel = new ArrayList<>();
        for (Long id : choice == null || choice.panel() == null ? List.<Long>of() : choice.panel()) {
            Interviewer i = byId.get(id);
            if (i != null && !panel.contains(i) && panel.size() < size) {
                panel.add(i);
            }
        }
        List<Interviewer> rest = new ArrayList<>(roster);
        rest.removeAll(panel);
        Collections.shuffle(rest, random);
        while (panel.size() < size) {
            panel.add(rest.removeFirst());
        }

        // Who asks each slot: the AI's pick when it is on the panel, else rotation.
        List<Long> picks = choice == null || choice.slotInterviewerIds() == null
                ? List.of() : choice.slotInterviewerIds();
        List<Interviewer> askers = new ArrayList<>();
        for (int slot = 0; slot < slotCount; slot++) {
            Interviewer pick = slot < picks.size() ? byId.get(picks.get(slot)) : null;
            askers.add(pick != null && panel.contains(pick) ? pick : panel.get(slot % size));
        }
        giveEveryPanelistAMainQuestion(panel, askers);

        // The introduction's asker leads the panel.
        Interviewer lead = askers.getFirst();
        panel.remove(lead);
        panel.addFirst(lead);
        return new Assignment(List.copyOf(panel), List.copyOf(askers));
    }

    /** A panelist with no main question takes the last one of whoever has the most (while anyone has 2+). */
    private static void giveEveryPanelistAMainQuestion(List<Interviewer> panel, List<Interviewer> askers) {
        for (Interviewer idle : panel) {
            if (askers.subList(1, askers.size()).contains(idle)) {
                continue;
            }
            Map<Interviewer, Integer> counts = new HashMap<>();
            askers.subList(1, askers.size()).forEach(a -> counts.merge(a, 1, Integer::sum));
            Interviewer busiest = counts.entrySet().stream()
                    .filter(e -> e.getValue() > 1)
                    .max(Map.Entry.comparingByValue())
                    .map(Map.Entry::getKey)
                    .orElse(null);
            if (busiest == null) {
                return; // fewer main questions than panelists
            }
            for (int slot = askers.size() - 1; slot >= 1; slot--) {
                if (Objects.equals(askers.get(slot), busiest)) {
                    askers.set(slot, idle);
                    break;
                }
            }
        }
    }
}
