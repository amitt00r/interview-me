package com.mockinterviewer.interview;

import java.util.List;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface InterviewRepository extends JpaRepository<Interview, Long> {

    // Don't add "turns" here: fetch-joining it alongside "interviewers" multiplies each turn by the panel size.
    @EntityGraph(attributePaths = {"company", "interviewers"})
    @Query("select i from Interview i where i.status in :statuses order by i.startedAt desc")
    List<Interview> findByStatusIn(@Param("statuses") List<InterviewStatus> statuses);

    List<Interview> findByRetakeOfOrderByAttempt(Interview original);

    /** The most recently started interview, if any; the assistant reuses its name and resume. */
    java.util.Optional<Interview> findFirstByOrderByStartedAtDesc();

    /** Every interview, newest first, with its company: the assistant lists the resumes they used. */
    @EntityGraph(attributePaths = {"company"})
    List<Interview> findAllByOrderByStartedAtDesc();

    @Query("select coalesce(max(i.attempt), 1) from Interview i where i.retakeOf = :original")
    int maxAttempt(@Param("original") Interview original);
}
