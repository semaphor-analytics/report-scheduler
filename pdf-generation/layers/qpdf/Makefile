build-QpdfLayer:
	mkdir -p "$(ARTIFACTS_DIR)/bin" "$(ARTIFACTS_DIR)/lib"
	if command -v dnf >/dev/null 2>&1; then dnf install -y qpdf; else yum install -y qpdf; fi
	QPDF_BIN="$$(command -v qpdf)"; \
	cp "$$QPDF_BIN" "$(ARTIFACTS_DIR)/bin/qpdf"; \
	ldd "$$QPDF_BIN" | awk '{ if ($$3 ~ /^\//) print $$3 }' | while read lib; do \
	  cp -L "$$lib" "$(ARTIFACTS_DIR)/lib/"; \
	done
