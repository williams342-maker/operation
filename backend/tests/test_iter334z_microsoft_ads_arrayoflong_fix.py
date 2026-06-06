"""iter334z — Regression: Microsoft Ads SOAP `ArrayOflong` fix.

Before the fix, `_run_report_sync` did:
    scope.AccountIds = factory.create("ArrayOflong")
    scope.AccountIds.long.append(int(account_id))

…which threw `Type not found: 'ArrayOflong'` because the bingads v13
reporting WSDL namespaces that type — `factory.create()` can't resolve
the bare name. Microsoft's official Python sample uses the dict-literal
shape `{'long': [account_id]}`, which suds serializes correctly.

This test pins the dict-literal pattern in source so a future refactor
can't silently regress to the broken `factory.create("ArrayOflong")`
form (the bug would only surface against the live Bing endpoint).
"""
from __future__ import annotations
import inspect


def test_microsoft_ads_sdk_uses_dict_literal_for_accountids():
    from routers import microsoft_ads_sdk

    src = inspect.getsource(microsoft_ads_sdk._run_report_sync)
    # Strip comments so the assertions only check executable code.
    code_lines = [
        ln for ln in src.splitlines()
        if not ln.lstrip().startswith("#")
    ]
    code = "\n".join(code_lines)

    # Positive assertion: dict-literal pattern is present.
    assert 'scope.AccountIds = {"long":' in code or \
           "scope.AccountIds = {'long':" in code, (
        "Microsoft Ads sync must build AccountIds as a dict literal "
        "({'long': [int(account_id)]}) per the official Bing Ads SDK "
        "sample — factory.create('ArrayOflong') throws Type not found."
    )
    # Negative assertion: the broken pattern must not return.
    assert 'factory.create("ArrayOflong")' not in code
    assert "factory.create('ArrayOflong')" not in code
