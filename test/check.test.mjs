import test from 'node:test'
import assert from 'node:assert/strict'
import { containsLocalAbsolutePath } from '../scripts/check-paths.mjs'

test('release path scan detects Windows user paths with each separator style', () => {
  for (const path of [
    String.raw`C:\Users\alice\private\note.md`,
    String.raw`C:\\Users\\alice\\private\\note.md`,
    'C:/Users/alice/private/note.md',
    String.raw`c:\users\张三/private\note.md`,
  ]) {
    assert.equal(containsLocalAbsolutePath(`Saved to ${path}`), true, path)
  }
})

test('release path scan retains detection of non-C drive paths', () => {
  for (const path of [String.raw`D:\private\note.md`, String.raw`E:\\private\\note.md`, 'Z:/private/note.md']) {
    assert.equal(containsLocalAbsolutePath(path), true, path)
  }
})

test('release path scan retains macOS and Linux home detection', () => {
  for (const path of ['/Users/alice/private/note.md', '/Users/user.name-1/.dsh/', '/home/alice/private/note.md', '/home/user_name/.dsh/']) {
    assert.equal(containsLocalAbsolutePath(path), true, path)
  }
})

test('release path scan allows generic tools and portable path examples', () => {
  for (const path of [
    String.raw`C:\Program Files\Git\mingw64\bin\pdftotext.exe`,
    String.raw`C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe`,
    'C:/Program Files/Git/mingw64/bin/pdftotext.exe',
    String.raw`%USERPROFILE%\.dsh\knowledge-center`,
    '$DSH_HOME/knowledge-center/',
    'docs/VERIFICATION.md',
    'https://github.com/deepseek-ai/deepseek-harness',
  ]) {
    assert.equal(containsLocalAbsolutePath(path), false, path)
  }
})
