# Shared Skill Resources

This directory contains code and assets shared across multiple skills to avoid duplication.

## `office/`

Shared Office document processing utilities (Python). Used by:

- `skills/docx/` — Word document processing
- `skills/pptx/` — PowerPoint presentation processing
- `skills/xlsx/` — Excel spreadsheet processing

Each of those skills links to this shared copy via symlink:

```
skills/{docx,pptx,xlsx}/scripts/office -> ../../_shared/office
```

### History

Prior to this consolidation the identical `office/` directory was duplicated
in all three skill directories (~22,500 lines x 3 copies). Consolidated on
2026-03-24 as part of the P2 architecture governance cleanup.
