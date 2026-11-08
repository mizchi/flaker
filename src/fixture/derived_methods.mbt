// Explicit trait extensions preserve the public method API.

///|
pub extend FixtureChangedFile with @json.FromJson::{from_json}

///|
pub extend FixtureChangedFile with @json.ToJson::{to_json}

///|
pub extend FixtureChangedFile with Eq::{not_equal, equal}

///|
pub extend FixtureChangedFile with Show::{to_string, output}

///|
pub extend FixtureCommit with @json.FromJson::{from_json}

///|
pub extend FixtureCommit with @json.ToJson::{to_json}

///|
pub extend FixtureCommit with Eq::{not_equal, equal}

///|
pub extend FixtureCommit with Show::{to_string, output}

///|
pub extend FixtureCommitResult with @json.FromJson::{from_json}

///|
pub extend FixtureCommitResult with @json.ToJson::{to_json}

///|
pub extend FixtureCommitResult with Eq::{not_equal, equal}

///|
pub extend FixtureCommitResult with Show::{to_string, output}

///|
pub extend FixtureConfig with @json.FromJson::{from_json}

///|
pub extend FixtureConfig with @json.ToJson::{to_json}

///|
pub extend FixtureConfig with Eq::{not_equal, equal}

///|
pub extend FixtureConfig with Show::{to_string, output}

///|
pub extend FixtureData with @json.FromJson::{from_json}

///|
pub extend FixtureData with @json.ToJson::{to_json}

///|
pub extend FixtureData with Eq::{not_equal, equal}

///|
pub extend FixtureData with Show::{to_string, output}

///|
pub extend FixtureFileDep with @json.FromJson::{from_json}

///|
pub extend FixtureFileDep with @json.ToJson::{to_json}

///|
pub extend FixtureFileDep with Eq::{not_equal, equal}

///|
pub extend FixtureFileDep with Show::{to_string, output}

///|
pub extend FixtureTest with @json.FromJson::{from_json}

///|
pub extend FixtureTest with @json.ToJson::{to_json}

///|
pub extend FixtureTest with Eq::{not_equal, equal}

///|
pub extend FixtureTest with Show::{to_string, output}
