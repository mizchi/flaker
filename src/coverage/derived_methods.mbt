// Explicit trait extensions preserve the public method API.

///|
pub extend CoverageGuidedResult with @json.FromJson::{from_json}

///|
pub extend CoverageGuidedResult with @json.ToJson::{to_json}

///|
pub extend CoverageGuidedResult with Eq::{not_equal, equal}

///|
pub extend CoverageGuidedResult with Show::{to_string, output}

///|
pub extend TestCoverage with @json.FromJson::{from_json}

///|
pub extend TestCoverage with @json.ToJson::{to_json}

///|
pub extend TestCoverage with Eq::{not_equal, equal}

///|
pub extend TestCoverage with Show::{to_string, output}
