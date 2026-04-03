///|
pub(all) struct DecisionStump {
  feature_idx : Int
  threshold : Double
  left_value : Double
  right_value : Double
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct GBDTModel {
  trees : Array[DecisionStump]
  learning_rate : Double
  feature_names : Array[String]
  base_score : Double
} derive(Eq, Show, FromJson, ToJson)

///|
pub(all) struct TrainingRow {
  features : Array[Double]
  label : Double  // 0.0 or 1.0
} derive(Eq, Show, FromJson, ToJson)
