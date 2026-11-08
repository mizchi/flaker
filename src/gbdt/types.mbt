///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, FromJson, ToJson)
pub(all) struct DecisionStump {
  feature_idx : Int32
  threshold : Double
  left_value : Double
  right_value : Double
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, FromJson, ToJson)
pub(all) struct GBDTModel {
  trees : Array[DecisionStump]
  learning_rate : Double
  feature_names : Array[String]
  base_score : Double
}

///|
#warnings("-deprecated-deprecated_syntax")
#derive(Eq, Show, FromJson, ToJson)
pub(all) struct TrainingRow {
  features : Array[Double]
  label : Double // 0.0 or 1.0
}
