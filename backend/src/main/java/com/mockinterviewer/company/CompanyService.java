package com.mockinterviewer.company;

import com.mockinterviewer.common.BadRequestException;
import com.mockinterviewer.common.NotFoundException;
import com.mockinterviewer.company.CompanyDtos.CompanyRequest;
import com.mockinterviewer.company.CompanyDtos.CompanyResponse;
import java.util.List;
import java.util.Optional;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Companies: the only class that touches {@link CompanyRepository}. Requests arrive already Bean-validated. */
@Service
public class CompanyService {

    private final CompanyRepository companies;

    public CompanyService(CompanyRepository companies) {
        this.companies = companies;
    }

    @Transactional(readOnly = true)
    public List<CompanyResponse> list() {
        return companies.findAll(Sort.by("name")).stream().map(this::response).toList();
    }

    @Transactional(readOnly = true)
    public CompanyResponse get(Long id) {
        return response(find(id));
    }

    @Transactional
    public CompanyResponse create(CompanyRequest req) {
        String name = req.name().trim();
        if (companies.existsByNameIgnoreCase(name)) {
            throw new BadRequestException("A company named '" + name + "' already exists");
        }
        Company c = new Company(name, req.industry(), req.description(), req.interviewFocus(),
                blankToNull(req.logoUrl()));
        return response(companies.save(c));
    }

    @Transactional
    public CompanyResponse update(Long id, CompanyRequest req) {
        Company c = find(id);
        c.update(req.name().trim(), req.industry(), req.description(), req.interviewFocus(),
                blankToNull(req.logoUrl()));
        return response(c);
    }

    @Transactional
    public void delete(Long id) {
        try {
            companies.delete(find(id));
            companies.flush();
        } catch (DataIntegrityViolationException e) {
            throw new BadRequestException(
                    "Company still has interviewers or past interviews. Delete its interviewers first.");
        }
    }

    /** The entity, for other services. */
    @Transactional(readOnly = true)
    public Optional<Company> findById(Long id) {
        return id == null ? Optional.empty() : companies.findById(id);
    }

    /** The entity, for other services; {@link NotFoundException} when missing. */
    @Transactional(readOnly = true)
    public Company find(Long id) {
        return findById(id).orElseThrow(() -> new NotFoundException("Company", id));
    }

    private CompanyResponse response(Company c) {
        return CompanyResponse.from(c, companies.countInterviewers(c.getId()));
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }
}
