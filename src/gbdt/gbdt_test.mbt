test "train and predict on separable data" {
  let data : Array[TrainingRow] = []
  for i in 0..<20 {
    data.push(
      TrainingRow::{
        features: [i.to_double()],
        label: if i > 10 { 1.0 } else { 0.0 },
      },
    )
  }
  let model = train(data, num_trees=10, learning_rate=0.3, feature_names=["value"])
  assert_true!(model.trees.length() == 10)
  // Low values → low probability
  assert_true!(predict(model, [0.0]) < 0.3)
  assert_true!(predict(model, [5.0]) < 0.3)
  // High values → high probability
  assert_true!(predict(model, [15.0]) > 0.7)
  assert_true!(predict(model, [19.0]) > 0.7)
}

test "predict_batch returns correct length" {
  let data : Array[TrainingRow] = Array::makei(20, fn(i) {
    TrainingRow::{
      features: [i.to_double()],
      label: if i > 10 { 1.0 } else { 0.0 },
    }
  })
  let model = train(data, num_trees=5, learning_rate=0.3)
  let preds = predict_batch(model, [[0.0], [5.0], [15.0], [19.0]])
  assert_true!(preds.length() == 4)
  assert_true!(preds[0] < preds[3])
}

test "empty training data" {
  let model = train([], num_trees=5)
  assert_true!(model.trees.is_empty())
}

test "model is JSON serializable" {
  let data : Array[TrainingRow] = Array::makei(20, fn(i) {
    TrainingRow::{
      features: [i.to_double()],
      label: if i > 10 { 1.0 } else { 0.0 },
    }
  })
  let model = train(data, num_trees=5, feature_names=["x"])
  let json_str = model.to_json().stringify()
  // Verify it produces valid JSON with expected fields
  assert_true!(json_str.contains("trees"))
  assert_true!(json_str.contains("learning_rate"))
  assert_true!(json_str.contains("base_score"))
}
