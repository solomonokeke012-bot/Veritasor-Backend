import { describe, it, expect } from 'vitest'
import MerkleTree from '../../../src/services/merkle'

describe('MerkleTree', () => {
  const leaves = ['a', 'b', 'c', 'd', 'e']

  it('produces a deterministic root', () => {
    const t1 = new MerkleTree(leaves)
    const t2 = new MerkleTree(leaves)
    expect(t1.getRoot()).toBe(t2.getRoot())
  })

  it('verifies a valid proof', () => {
    const tree = new MerkleTree(leaves)
    const index = 2
    const proof = tree.getProof(index)
    const root = tree.getRoot()
    const ok = MerkleTree.verifyProof(leaves[index], proof, root, index)
    expect(ok).toBe(true)
  })

  it('rejects a tampered proof', () => {
    const tree = new MerkleTree(leaves)
    const index = 2
    const proof = tree.getProof(index)
    const root = tree.getRoot()
    const badProof = [...proof]
    if (badProof.length > 0) {
      badProof[0] = badProof[0].replace(/^[0-9a-f]/, (c) => (c === '0' ? '1' : '0'))
    }
    const bad = MerkleTree.verifyProof(leaves[index], badProof, root, index)
    expect(bad).toBe(false)
  })
})
describe('MerkleTree – empty dataset rejection', () => {

  it('throws when constructed with an empty array', () => {
    expect(() => new MerkleTree([])).toThrow()
  })

  it('throws an error (not silently returns undefined root)', () => {
    expect(() => new MerkleTree([])).toThrowError()
  })

  it('does not return a valid root for empty input', () => {
    let root: string | undefined
    try {
      const tree = new MerkleTree([])
      root = tree.getRoot()
    } catch {
      root = undefined
    }
    expect(root).toBeUndefined()
  })

  it('throws when all leaves are empty strings', () => {
    expect(() => new MerkleTree(['', '', ''])).toThrow()
  })

  it('does not produce the same root as a non-empty tree when given empty input', () => {
    const validTree = new MerkleTree(['a'])
    let emptyRoot: string | undefined
    try {
      emptyRoot = new MerkleTree([]).getRoot()
    } catch {
      emptyRoot = undefined
    }
    expect(emptyRoot).not.toBe(validTree.getRoot())
  })

})
