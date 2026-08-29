# Vendored schemas

## `mspdi_pj12.xsd`

The Microsoft Office Project 2007 XML Data Interchange (MSPDI) schema,
downloaded verbatim from
<https://schemas.microsoft.com/project/2007/mspdi_pj12.xsd> (revision date
2007-11-28, UTF-8 BOM stripped).

It is vendored so `tests/test_msproject.py` can validate the MS Project export
without network access.

MSPDI models every element as an `xsd:sequence`, so element **order** is part
of the contract — MS Project refuses to open a file whose elements are out of
schema order, which is what issue #753 reported. The schema declares its
target namespace as `http://schemas.microsoft.com/project/2007`, while files
written by MS Project itself use the unversioned
`http://schemas.microsoft.com/project`. The validator in the tests compares
local names only, so it works with either.
