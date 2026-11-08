///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, FromJson, ToJson)
pub(all) struct FixtureConfig {
  test_count : Int32
  commit_count : Int32
  flaky_rate : Double
  co_failure_strength : Double
  files_per_commit : Int32
  tests_per_file : Int32
  sample_percentage : Double
  seed : Int32
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, FromJson, ToJson)
pub(all) struct FixtureTest {
  suite : String
  test_name : String
  is_flaky : Bool
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, FromJson, ToJson)
pub(all) struct FixtureChangedFile {
  file_path : String
  change_type : String
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, FromJson, ToJson)
pub(all) struct FixtureCommitResult {
  suite : String
  test_name : String
  status : String
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, FromJson, ToJson)
pub(all) struct FixtureCommit {
  sha : String
  changed_files : Array[FixtureChangedFile]
  test_results : Array[FixtureCommitResult]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, FromJson, ToJson)
pub(all) struct FixtureFileDep {
  file : String
  suites : Array[String]
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, FromJson, ToJson)
pub(all) struct FixtureData {
  tests : Array[FixtureTest]
  files : Array[String]
  file_deps : Array[FixtureFileDep]
  commits : Array[FixtureCommit]
  config : FixtureConfig
}
