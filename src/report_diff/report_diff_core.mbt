///|
pub fn classify_report_diff(
  inputs : Array[@types.ReportDiffStatusInput],
) -> @types.ReportDiffBuckets {
  let new_failures : Array[String] = []
  let new_flaky : Array[String] = []
  let resolved_failures : Array[String] = []
  let resolved_flaky : Array[String] = []
  let persistent_flaky : Array[String] = []

  for input in inputs {
    let base_status = input.base_status
    let head_status = input.head_status

    if head_status == "failed" && base_status != "failed" {
      new_failures.push(input.test_id)
    }

    if head_status == "flaky" {
      if base_status == "flaky" {
        persistent_flaky.push(input.test_id)
      } else if base_status != "failed" {
        new_flaky.push(input.test_id)
      }
    }

    if base_status == "failed" && head_status != "failed" && head_status != "" {
      resolved_failures.push(input.test_id)
    }

    if base_status == "flaky" && head_status != "flaky" && head_status != "" {
      resolved_flaky.push(input.test_id)
    }
  }

  @types.ReportDiffBuckets::{
    new_failures,
    new_flaky,
    resolved_failures,
    resolved_flaky,
    persistent_flaky,
  }
}
