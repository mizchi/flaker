///|
fn main {
  ()
}

///|
pub fn detect_flaky_json(input_json : String) -> String {
  let input : @types.DetectInput = try! @json.from_json(
    try! @json.parse(input_json),
  )
  let output = @flaky_detector.detect_flaky(input)
  output.to_json().stringify()
}

///|
pub fn sample_random_json(
  meta_json : String,
  count : Int,
  seed : Int,
) -> String {
  let meta : Array[@types.TestMeta] = try! @json.from_json(
    try! @json.parse(meta_json),
  )
  let result = @sampler.sample_random(meta, count~, seed=seed.to_uint64())
  result.to_json().stringify()
}

///|
pub fn sample_weighted_json(
  meta_json : String,
  count : Int,
  seed : Int,
) -> String {
  let meta : Array[@types.TestMeta] = try! @json.from_json(
    try! @json.parse(meta_json),
  )
  let result = @sampler.sample_weighted(meta, count~, seed=seed.to_uint64())
  result.to_json().stringify()
}

///|
pub fn sample_hybrid_json(meta_json : String, affected_json : String, count : Int, seed : Int) -> String {
  let meta : Array[@types.TestMeta] = try! @json.from_json(try! @json.parse(meta_json))
  let affected : Array[String] = try! @json.from_json(try! @json.parse(affected_json))
  let result = @sampler.sample_hybrid(meta, affected_suites=affected, count~, seed=seed.to_uint64())
  result.to_json().stringify()
}

///|
pub fn resolve_affected_json(
  workflow_text : String,
  changed_paths_json : String,
) -> String {
  let changed : Array[String] = try! @json.from_json(
    try! @json.parse(changed_paths_json),
  )
  let result = @affected.resolve_affected(workflow_text, changed)
  result.to_json().stringify()
}
