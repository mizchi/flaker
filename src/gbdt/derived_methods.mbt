// Explicit trait extensions preserve the public method API.

///|
pub extend DecisionStump with @json.FromJson::{from_json}

///|
pub extend DecisionStump with @json.ToJson::{to_json}

///|
pub extend DecisionStump with Eq::{not_equal, equal}

///|
pub extend DecisionStump with Show::{to_string, output}

///|
pub extend GBDTModel with @json.FromJson::{from_json}

///|
pub extend GBDTModel with @json.ToJson::{to_json}

///|
pub extend GBDTModel with Eq::{not_equal, equal}

///|
pub extend GBDTModel with Show::{to_string, output}

///|
pub extend TrainingRow with @json.FromJson::{from_json}

///|
pub extend TrainingRow with @json.ToJson::{to_json}

///|
pub extend TrainingRow with Eq::{not_equal, equal}

///|
pub extend TrainingRow with Show::{to_string, output}
