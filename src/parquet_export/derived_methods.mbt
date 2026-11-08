// Explicit trait extensions preserve the public method API.

///|
pub extend CommitChangeRow with @json.FromJson::{from_json}

///|
pub extend CommitChangeRow with @json.ToJson::{to_json}

///|
pub extend CommitChangeRow with Show::{to_string, output}

///|
pub extend TestResultRow with @json.FromJson::{from_json}

///|
pub extend TestResultRow with @json.ToJson::{to_json}

///|
pub extend TestResultRow with Show::{to_string, output}

///|
pub extend WorkflowRunRow with @json.FromJson::{from_json}

///|
pub extend WorkflowRunRow with @json.ToJson::{to_json}

///|
pub extend WorkflowRunRow with Show::{to_string, output}
