/**
 * EntityRegistry（里程碑 4）：实体 ID / Item UID 的唯一所有者。
 * 旧的全局分配函数改为委托默认实例——行为不变，所有权收拢；
 * 多 Game 实例隔离通过 reset() / setWatermark() 显式管理。
 */
export class EntityRegistry {
  private nextActorId = 1;
  private nextItemUid = 1;

  allocateActorId(): number {
    return this.nextActorId++;
  }

  allocateItemUid(): number {
    return this.nextItemUid++;
  }

  /** 新开一局：清零（保证回放/测试的确定性） */
  reset(): void {
    this.nextActorId = 1;
    this.nextItemUid = 1;
  }

  /** 读档后恢复水位：新建实体 ID 不与存档实体冲突（P0-5） */
  setWatermark(actorId: number, itemUid: number): void {
    this.nextActorId = Math.max(this.nextActorId, actorId);
    this.nextItemUid = Math.max(this.nextItemUid, itemUid);
  }

  snapshot(): { actorId: number; itemUid: number } {
    return { actorId: this.nextActorId, itemUid: this.nextItemUid };
  }
}

/** 默认实例：模块级分配函数与既有调用方（catalog 等）委托到此 */
export const defaultEntityRegistry = new EntityRegistry();

export function allocateActorId(): number {
  return defaultEntityRegistry.allocateActorId();
}

export function allocateItemUid(): number {
  return defaultEntityRegistry.allocateItemUid();
}

export function resetEntityIds(): void {
  defaultEntityRegistry.reset();
}

export function setEntityIdCounters(actorId: number, itemUid: number): void {
  defaultEntityRegistry.setWatermark(actorId, itemUid);
}
