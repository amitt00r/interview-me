package com.mockinterviewer.interviewer;

import java.util.List;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface InterviewerRepository extends JpaRepository<Interviewer, Long> {

    @EntityGraph(attributePaths = "company")
    @Query("select i from Interviewer i order by i.name")
    List<Interviewer> findAllWithCompany();

    @EntityGraph(attributePaths = "company")
    List<Interviewer> findByCompanyIdOrderByName(Long companyId);

    long countByCompanyId(Long companyId);
}
