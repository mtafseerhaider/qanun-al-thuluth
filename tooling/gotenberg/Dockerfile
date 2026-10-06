# tooling/gotenberg/Dockerfile
# Private PDF renderer for export-pdf (18 §2, 04 §4): Gotenberg 8 (Chromium) plus the fonts the
# export templates name, so rendering needs no network. Built and deployed by hand per README.md.
# Pin the tag to an exact 8.x release when building for production (check the Gotenberg changelog).
FROM gotenberg/gotenberg:8

USER root
# Noto Nastaliq Urdu, Noto Naskh Arabic and Noto Sans (fonts-noto-core), Amiri for scripture,
# Inter for Latin text. Debian package names; versions follow the base image's Debian release.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-core fonts-hosny-amiri fonts-inter \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*
USER gotenberg

# Hardened defaults (overridable in service.yaml):
# - basic auth (username thuluth, password from Secret Manager) so only export-pdf can call it
# - JavaScript off and Chromium limited to the request's own files: injected <img src=http://...>
#   or <script> in user text can neither run nor fetch (AC-E7)
# - only the Chromium HTML route is needed; LibreOffice and webhooks are switched off
CMD ["gotenberg", \
     "--api-port=8080", \
     "--api-timeout=30s", \
     "--api-enable-basic-auth", \
     "--chromium-disable-javascript=true", \
     "--chromium-allow-list=^file:///tmp/.*", \
     "--chromium-ignore-certificate-errors=false", \
     "--libreoffice-disable-routes=true", \
     "--webhook-disable=true", \
     "--prometheus-disable-collect=true", \
     "--log-format=json"]
