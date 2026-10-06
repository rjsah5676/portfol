/**
 * 키별 직렬 실행. 같은 방에 대한 "읽고 → 판단하고 → 쓰기"가 서로 끼어들지 않게 함
 * (기존 Firestore 트랜잭션이 하던 일. 서버가 한 프로세스라 메모리 잠금으로 충분).
 */
export class KeyedMutex {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    this.tails.set(key, tail);
    tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}
