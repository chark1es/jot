import Foundation

// Host entry point for `scripts/native-editor-check.ts`, which compiles it with the Foundation-only
// editor sources. Optional arguments: corpus.json fixturesDirectory output.json
do {
  try LinearModelTests.runAll()
  print("LinearModelTests passed")
  let arguments = CommandLine.arguments
  if arguments.count >= 4 {
    let corpus = try EditorCorpusRunner.readJSON(URL(fileURLWithPath: arguments[1]))
    let directory = URL(fileURLWithPath: arguments[2], isDirectory: true)
    let names = try FileManager.default.contentsOfDirectory(atPath: directory.path)
      .filter { $0.hasSuffix(".canonical.json") }
      .sorted()
    let fixtures = try names.map { (name: $0, document: try EditorCorpusRunner.readJSON(directory.appendingPathComponent($0))) }
    let output = EditorCorpusRunner.run(corpus: corpus, fixtures: fixtures)
    try CanonicalJSON.stringify(output).write(to: URL(fileURLWithPath: arguments[3]), atomically: true, encoding: .utf8)
    print("EditorCorpus wrote \(arguments[3])")
  }
} catch {
  print("Host tests failed: \(error)")
  exit(1)
}
