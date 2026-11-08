// Explicit trait extensions preserve the public method API.

///|
pub extend TestKey with Eq::{not_equal, equal}

///|
pub extend TestKey with Hash::{hash, hash_combine}

///|
pub extend TestKey with Show::{to_string, output}
