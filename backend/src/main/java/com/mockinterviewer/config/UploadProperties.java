package com.mockinterviewer.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Where uploaded files are kept, bound from {@code app.uploads.*}.
 *
 * @param dir base directory; relative paths resolve against the backend's working directory
 */
@ConfigurationProperties(prefix = "app.uploads")
public record UploadProperties(String dir) {
}
