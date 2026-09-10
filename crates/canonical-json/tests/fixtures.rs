use jot_canonical_json::{canonicalize, CanonicalValue};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/schema/fixtures")
}

fn from_serde(value: &Value) -> CanonicalValue {
    match value {
        Value::Null => CanonicalValue::Null,
        Value::Bool(flag) => CanonicalValue::Bool(*flag),
        Value::Number(number) => {
            let integer = number
                .as_i64()
                .unwrap_or_else(|| panic!("fixture number is not an i64 integer: {number}"));
            CanonicalValue::Integer(integer)
        }
        Value::String(text) => CanonicalValue::String(text.clone()),
        Value::Array(items) => CanonicalValue::Array(items.iter().map(from_serde).collect()),
        Value::Object(fields) => {
            let mut object = BTreeMap::new();
            for (key, field) in fields {
                object.insert(key.clone(), from_serde(field));
            }
            CanonicalValue::Object(object)
        }
    }
}

#[test]
fn canonical_fixtures_are_byte_identical() {
    let dir = fixtures_dir();
    let mut found = 0;
    for entry in
        fs::read_dir(&dir).unwrap_or_else(|error| panic!("read {}: {error}", dir.display()))
    {
        let path = entry.unwrap().path();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if !name.ends_with(".canonical.json") {
            continue;
        }
        let expected = fs::read(&path).unwrap();
        let parsed: Value = serde_json::from_slice(&expected).unwrap();
        let actual = canonicalize(&from_serde(&parsed)).unwrap();
        assert_eq!(actual, expected, "{name} round-trip must be byte-identical");
        found += 1;
    }
    assert!(
        found >= 10,
        "expected at least 10 canonical fixtures, found {found}"
    );
}
