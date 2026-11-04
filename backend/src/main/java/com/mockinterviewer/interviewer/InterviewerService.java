package com.mockinterviewer.interviewer;

import com.mockinterviewer.common.BadRequestException;
import com.mockinterviewer.common.NotFoundException;
import com.mockinterviewer.company.Company;
import com.mockinterviewer.company.CompanyService;
import com.mockinterviewer.interviewer.InterviewerDtos.InterviewerRequest;
import com.mockinterviewer.interviewer.InterviewerDtos.InterviewerResponse;
import java.util.List;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Interviewers and their photos: the only class that touches {@link InterviewerRepository}. Requests arrive already
 * Bean-validated.
 */
@Service
public class InterviewerService {

    /** A stored photo and its content type. */
    public record Photo(byte[] data, String contentType) {
    }

    private final InterviewerRepository interviewers;
    private final CompanyService companies;
    private final PhotoStorage photos;

    public InterviewerService(InterviewerRepository interviewers, CompanyService companies, PhotoStorage photos) {
        this.interviewers = interviewers;
        this.companies = companies;
        this.photos = photos;
    }

    /** All interviewers, or one company's panel when {@code companyId} is given. */
    @Transactional(readOnly = true)
    public List<InterviewerResponse> list(Long companyId) {
        List<Interviewer> found = companyId == null
                ? interviewers.findAllWithCompany()
                : interviewers.findByCompanyIdOrderByName(companyId);
        return found.stream().map(InterviewerResponse::from).toList();
    }

    @Transactional(readOnly = true)
    public InterviewerResponse get(Long id) {
        return InterviewerResponse.from(find(id));
    }

    @Transactional
    public InterviewerResponse create(InterviewerRequest req) {
        Interviewer i = new Interviewer(req.name().trim(), req.title(), req.yearsOfExperience(), req.expertise(),
                req.background(), blankToNull(req.voice()), resolveCompany(req.companyId()));
        return InterviewerResponse.from(interviewers.save(i));
    }

    @Transactional
    public InterviewerResponse update(Long id, InterviewerRequest req) {
        Interviewer i = find(id);
        i.update(req.name().trim(), req.title(), req.yearsOfExperience(), req.expertise(), req.background(),
                blankToNull(req.voice()), resolveCompany(req.companyId()));
        return InterviewerResponse.from(i);
    }

    @Transactional
    public void delete(Long id) {
        Interviewer i = find(id);
        try {
            interviewers.delete(i);
            interviewers.flush();
        } catch (DataIntegrityViolationException e) {
            throw new BadRequestException("Interviewer took part in past interviews and cannot be deleted");
        }
        photos.delete(i.getPhotoFile());
    }

    /** Uploads or replaces the interviewer's photo. */
    @Transactional
    public InterviewerResponse uploadPhoto(Long id, byte[] data) {
        Interviewer i = find(id);
        String previous = i.getPhotoFile();
        i.setPhotoFile(photos.save(id, data));
        photos.delete(previous);
        return InterviewerResponse.from(i);
    }

    @Transactional(readOnly = true)
    public Photo photo(Long id) {
        String file = find(id).getPhotoFile();
        if (file == null || !photos.exists(file)) {
            throw new NotFoundException("Photo for interviewer", id);
        }
        return new Photo(photos.read(file), PhotoStorage.ImageType.ofFileName(file).contentType);
    }

    @Transactional
    public InterviewerResponse removePhoto(Long id) {
        Interviewer i = find(id);
        photos.delete(i.getPhotoFile());
        i.setPhotoFile(null);
        return InterviewerResponse.from(i);
    }

    /** A company's interviewers as entities, by name, for other services. */
    @Transactional(readOnly = true)
    public List<Interviewer> forCompany(Long companyId) {
        return interviewers.findByCompanyIdOrderByName(companyId);
    }

    @Transactional(readOnly = true)
    public long countForCompany(Long companyId) {
        return interviewers.countByCompanyId(companyId);
    }

    private Interviewer find(Long id) {
        return interviewers.findById(id).orElseThrow(() -> new NotFoundException("Interviewer", id));
    }

    private Company resolveCompany(Long id) {
        return companies.findById(id)
                .orElseThrow(() -> new BadRequestException("Company " + id + " does not exist"));
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }
}
