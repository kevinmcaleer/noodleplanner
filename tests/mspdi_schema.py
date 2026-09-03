"""A minimal MSPDI schema checker for the MS Project export tests.

MSPDI models every element as an ``xsd:sequence``, so element *order* is part
of the contract: Microsoft Project refuses to open a file whose children are
out of schema order, even though the file is perfectly well-formed XML.  That
is what issue #753 reported, and plain ``ET.parse`` cannot catch it.

This module walks the vendored schema alongside a generated document and
reports every ordering violation and missing required element.  It deliberately
checks structure only — types, enumerations and cross-references are left to
``xmllint``, which ``test_msproject.py`` also runs when it is installed.

The schema declares its target namespace as
``http://schemas.microsoft.com/project/2007`` while Microsoft Project itself
writes the unversioned ``http://schemas.microsoft.com/project``, so everything
here compares local names only.
"""

import xml.etree.ElementTree as ET
from pathlib import Path

XSD_NS = "{http://www.w3.org/2001/XMLSchema}"
SCHEMA_PATH = Path(__file__).parent / "schemas" / "mspdi_pj12.xsd"


def _local(tag: str) -> str:
    """Strip any namespace from an element tag."""
    return tag.split("}")[-1] if "}" in tag else tag


def _sequence_of(xsd_element):
    """Return the xsd:sequence node describing an element's children."""
    complex_type = xsd_element.find(f"{XSD_NS}complexType")
    if complex_type is None:
        return None
    return complex_type.find(f"{XSD_NS}sequence")


def _child_declarations(xsd_element):
    """Return [(name, required, xsd_node, position)] for an element's children.

    ``position`` is the child's slot in the sequence; children sharing a slot
    may appear in any order relative to each other.  A few MSPDI sequences wrap
    their elements in an ``xsd:choice``, so everything inside one choice shares
    a slot and counts as optional.

    Returns None for elements the schema gives no sequence for (simple types).
    """
    sequence = _sequence_of(xsd_element)
    if sequence is None:
        return None

    declarations = []
    for position, particle in enumerate(sequence):
        tag = _local(particle.tag)
        if tag == "element":
            required = particle.get("minOccurs", "1") != "0"
            declarations.append(
                (particle.get("name"), required, particle, position)
            )
        elif tag in ("choice", "sequence", "all"):
            for nested in particle.iter(f"{XSD_NS}element"):
                declarations.append(
                    (nested.get("name"), False, nested, position)
                )
    return declarations


def _check_element(xsd_element, doc_element, path, errors):
    """Recursively check one document element against its schema declaration."""
    declarations = _child_declarations(xsd_element)
    if declarations is None:
        return

    order = {name: position for name, _, _, position in declarations}
    nodes = {name: node for name, _, node, _ in declarations}

    seen = set()
    highest = -1
    highest_name = None

    for child in doc_element:
        name = _local(child.tag)
        if name not in order:
            errors.append(f"{path}: <{name}> is not allowed here")
            continue

        seen.add(name)
        position = order[name]
        # Repeats of an element (maxOccurs > 1) and members of the same choice
        # share a slot, so only a strictly earlier slot is out of order.
        if position < highest:
            errors.append(
                f"{path}: <{name}> appears after <{highest_name}> but the "
                f"schema orders it before"
            )
        elif position > highest:
            highest, highest_name = position, name

        _check_element(nodes[name], child, f"{path}/{name}", errors)

    for name, required, _, _ in declarations:
        if required and name not in seen:
            errors.append(f"{path}: required <{name}> is missing")


def validate_mspdi(xml_path) -> list:
    """Validate an MSPDI document's structure. Returns a list of errors.

    An empty list means the document's element order and required elements
    match the schema.
    """
    schema_root = ET.parse(SCHEMA_PATH).getroot()
    project_decl = next(
        element
        for element in schema_root.findall(f"{XSD_NS}element")
        if element.get("name") == "Project"
    )

    doc_root = ET.parse(xml_path).getroot()
    if _local(doc_root.tag) != "Project":
        return [f"root element is <{_local(doc_root.tag)}>, expected <Project>"]

    errors: list = []
    _check_element(project_decl, doc_root, "Project", errors)
    return errors
