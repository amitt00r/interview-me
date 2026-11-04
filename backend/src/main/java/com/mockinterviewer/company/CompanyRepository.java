package com.mockinterviewer.company;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface CompanyRepository extends JpaRepository<Company, Long> {

    boolean existsByNameIgnoreCase(String name);

    /** How many interviewers the company has (kept here so CompanyService needn't depend on InterviewerService). */
    @Query("select count(i) from Interviewer i where i.company.id = :companyId")
    long countInterviewers(Long companyId);
}
