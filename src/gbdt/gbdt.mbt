///| Sigmoid function
fn sigmoid(x : Double) -> Double {
  1.0 / (1.0 + @math.exp(-x))
}

///| Find best split for a single feature (decision stump)
fn find_best_split(
  features : Array[Double],
  residuals : Array[Double],
  weights : Array[Double],
) -> (Double, Double, Double, Double) {
  // (threshold, leftValue, rightValue, gain)
  let n = features.length()
  // Sort indices by feature value
  let indices = Array::makei(n, fn(i) { i })
  indices.sort_by(fn(a, b) { features[a].compare(features[b]) })

  let mut best_gain = -1.0e30
  let mut best_threshold = 0.0
  let mut best_left = 0.0
  let mut best_right = 0.0

  for split_idx in 0..<(n - 1) {
    let threshold = (features[indices[split_idx]] + features[indices[split_idx + 1]]) / 2.0

    let mut left_sum = 0.0
    let mut left_w = 0.0
    let mut right_sum = 0.0
    let mut right_w = 0.0

    for i in 0..<n {
      let idx = indices[i]
      if features[idx] <= threshold {
        left_sum += residuals[idx]
        left_w += weights[idx]
      } else {
        right_sum += residuals[idx]
        right_w += weights[idx]
      }
    }

    if left_w == 0.0 || right_w == 0.0 {
      continue
    }

    let left_val = left_sum / left_w
    let right_val = right_sum / right_w
    let gain = left_sum * left_sum / left_w + right_sum * right_sum / right_w

    if gain > best_gain {
      best_gain = gain
      best_threshold = threshold
      best_left = left_val
      best_right = right_val
    }
  }

  (best_threshold, best_left, best_right, best_gain)
}

///| Train a GBDT model
pub fn train(
  data : Array[TrainingRow],
  num_trees~ : Int = 10,
  learning_rate~ : Double = 0.1,
  feature_names~ : Array[String] = [],
) -> GBDTModel {
  let n = data.length()
  if n == 0 {
    return GBDTModel::{
      trees: [],
      learning_rate,
      feature_names,
      base_score: 0.0,
    }
  }
  let num_features = data[0].features.length()
  let names = if feature_names.is_empty() {
    Array::makei(num_features, fn(i) { "f\{i}" })
  } else {
    feature_names
  }

  // Base score: log-odds of positive class
  let mut pos_count = 0.0
  for row in data {
    pos_count += row.label
  }
  let base_score = @math.ln((pos_count + 1.0) / (n.to_double() - pos_count + 1.0))

  let predictions = Array::make(n, base_score)
  let trees : Array[DecisionStump] = []

  for _ in 0..<num_trees {
    // Compute residuals and weights
    let residuals = Array::makei(n, fn(i) {
      data[i].label - sigmoid(predictions[i])
    })
    let weights = Array::makei(n, fn(i) {
      let p = sigmoid(predictions[i])
      p * (1.0 - p)
    })

    // Find best stump across all features
    let mut best_stump = DecisionStump::{
      feature_idx: 0,
      threshold: 0.0,
      left_value: 0.0,
      right_value: 0.0,
    }
    let mut best_gain = -1.0e30

    for f in 0..<num_features {
      let feat_values = Array::makei(n, fn(i) { data[i].features[f] })
      let (threshold, left_val, right_val, gain) = find_best_split(
        feat_values,
        residuals,
        weights,
      )
      if gain > best_gain {
        best_gain = gain
        best_stump = DecisionStump::{
          feature_idx: f,
          threshold,
          left_value: left_val,
          right_value: right_val,
        }
      }
    }

    trees.push(best_stump)

    // Update predictions
    for i in 0..<n {
      let value = if data[i].features[best_stump.feature_idx] <= best_stump.threshold {
        best_stump.left_value
      } else {
        best_stump.right_value
      }
      predictions[i] += learning_rate * value
    }
  }

  GBDTModel::{ trees, learning_rate, feature_names: names, base_score }
}

///| Predict probability of label=1 for a single sample
pub fn predict(model : GBDTModel, features : Array[Double]) -> Double {
  let mut score = model.base_score
  for tree in model.trees {
    let value = if features[tree.feature_idx] <= tree.threshold {
      tree.left_value
    } else {
      tree.right_value
    }
    score += model.learning_rate * value
  }
  sigmoid(score)
}

///| Predict for multiple samples
pub fn predict_batch(
  model : GBDTModel,
  batch : Array[Array[Double]],
) -> Array[Double] {
  Array::makei(batch.length(), fn(i) { predict(model, batch[i]) })
}
