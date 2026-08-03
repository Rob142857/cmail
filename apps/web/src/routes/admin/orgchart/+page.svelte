<script lang="ts">
  type Visibility = 'internal' | 'public';
  type ResourceKind = 'layer' | 'unit' | 'role' | 'position';
  type FilterKind = 'all' | ResourceKind;
  type EditorMode = 'create' | 'edit';
  type ViewMode = 'hierarchy' | 'resources';

  interface Layer {
    id: string;
    name: string;
    description: string | null;
    sort_order: number;
  }

  interface Unit {
    id: string;
    name: string;
    description: string | null;
    layer_id: string;
    parent_id: string | null;
    sort_order: number;
  }

  interface RoleDefinition {
    id: string;
    title: string;
    description: string | null;
    sort_order: number;
  }

  interface Position {
    id: string;
    unit_id: string;
    role_id: string;
    user_id: string | null;
    title_override: string | null;
    occupant_display_name: string | null;
    work_email: string | null;
    visibility: Visibility;
    sort_order: number;
  }

  interface UnitTreeNode {
    unit: Unit;
    children: UnitTreeNode[];
    positions: Position[];
    parentOutsideLayer: string | null;
  }

  interface LayerTree {
    layer: Layer;
    roots: UnitTreeNode[];
    unitCount: number;
    positionCount: number;
  }

  interface User {
    id: string;
    email: string;
    display_name: string;
    status?: string;
  }

  interface WorkMailbox {
    id: string;
    address: string;
    display_name: string;
    type: string;
    status: string;
    user_id: string | null;
  }

  interface OrganizationData {
    directoryEnabled?: boolean | number;
    layers?: Layer[];
    units?: Unit[];
    roles?: RoleDefinition[];
    positions?: Position[];
    workMailboxes?: WorkMailbox[];
  }

  interface PageData extends OrganizationData {
    appName?: string;
    organization?: OrganizationData;
    users?: User[];
    workMailboxes?: WorkMailbox[];
  }

  type Resource =
    | { key: string; kind: 'layer'; label: string; subtitle: string; meta: string; item: Layer }
    | { key: string; kind: 'unit'; label: string; subtitle: string; meta: string; item: Unit }
    | { key: string; kind: 'role'; label: string; subtitle: string; meta: string; item: RoleDefinition }
    | { key: string; kind: 'position'; label: string; subtitle: string; meta: string; item: Position };

  let { data, form } = $props<{
    data: PageData;
    form?: { error?: string; success?: string } | null;
  }>();

  const organization: OrganizationData = $derived(data.organization ?? data);
  const layers: Layer[] = $derived(organization.layers ?? []);
  const units: Unit[] = $derived(organization.units ?? []);
  const roles: RoleDefinition[] = $derived(organization.roles ?? []);
  const positions: Position[] = $derived(organization.positions ?? []);
  const users: User[] = $derived(data.users ?? []);
  const workMailboxes: WorkMailbox[] = $derived(
    (data.workMailboxes ?? organization.workMailboxes ?? []).filter((mailbox: WorkMailbox) => mailbox.status === 'active'),
  );
  const directoryEnabled = $derived(Boolean(organization.directoryEnabled ?? data.directoryEnabled ?? false));
  const hasStructure = $derived(layers.length + units.length + roles.length + positions.length > 0);

  let query = $state('');
  let filter = $state<FilterKind>('all');
  let viewMode = $state<ViewMode>('hierarchy');
  let collapsedLayerIds = $state<string[]>([]);
  let collapsedUnitIds = $state<string[]>([]);
  let blade = $state<HTMLDialogElement>();
  let firstField = $state<HTMLInputElement | HTMLSelectElement>();
  let editorKind = $state<ResourceKind>('layer');
  let editorMode = $state<EditorMode>('create');
  let selectedResource = $state<Resource | null>(null);
  let positionVisibility = $state<Visibility>('internal');
  let positionUserId = $state('');
  let positionWorkEmail = $state('');

  const selectedLayer = $derived(selectedResource?.kind === 'layer' ? selectedResource.item : null);
  const selectedUnit = $derived(selectedResource?.kind === 'unit' ? selectedResource.item : null);
  const selectedRole = $derived(selectedResource?.kind === 'role' ? selectedResource.item : null);
  const selectedPosition = $derived(selectedResource?.kind === 'position' ? selectedResource.item : null);
  const eligibleWorkMailboxes: WorkMailbox[] = $derived(
    positionUserId ? workMailboxes.filter((mailbox) => mailbox.user_id === positionUserId) : [],
  );
  const publicPositions = $derived(positions.filter((position) => position.visibility === 'public'));
  const eligiblePublicPositions = $derived(publicPositions.filter((position) => {
    const user = users.find((item) => item.id === position.user_id);
    return Boolean(
      user?.status === 'active'
      && position.occupant_display_name?.trim()
      && position.work_email?.trim()
      && workMailboxes.some((mailbox) =>
        mailbox.user_id === position.user_id
        && mailbox.address.toLowerCase() === position.work_email?.toLowerCase()),
    );
  }));
  const ineligiblePublicCount = $derived(publicPositions.length - eligiblePublicPositions.length);

  const hierarchy = $derived.by<LayerTree[]>(() => layers.map((layer) => {
    const layerUnits = units.filter((unit) => unit.layer_id === layer.id);
    const layerUnitIds = new Set(layerUnits.map((unit) => unit.id));
    const visited = new Set<string>();

    function buildNode(unit: Unit): UnitTreeNode {
      visited.add(unit.id);
      return {
        unit,
        positions: positions.filter((position) => position.unit_id === unit.id),
        children: layerUnits
          .filter((candidate) => candidate.parent_id === unit.id && !visited.has(candidate.id))
          .map(buildNode),
        parentOutsideLayer: unit.parent_id && !layerUnitIds.has(unit.parent_id)
          ? unitName(unit.parent_id)
          : null,
      };
    }

    const roots = layerUnits
      .filter((unit) => !unit.parent_id || !layerUnitIds.has(unit.parent_id))
      .map(buildNode);

    // Keep damaged or legacy data visible for repair rather than silently
    // dropping a branch if its parent relationship cannot be traversed.
    for (const unit of layerUnits) {
      if (!visited.has(unit.id)) roots.push(buildNode(unit));
    }

    return {
      layer,
      roots,
      unitCount: layerUnits.length,
      positionCount: positions.filter((position) => layerUnitIds.has(position.unit_id)).length,
    };
  }));

  function layerName(id: string | null): string {
    return layers.find((layer) => layer.id === id)?.name || 'No layer';
  }

  function unitName(id: string | null): string {
    return units.find((unit) => unit.id === id)?.name || 'No unit';
  }

  function roleName(id: string | null): string {
    return roles.find((role) => role.id === id)?.title || 'No role';
  }

  function userName(id: string | null): string {
    const user = users.find((item) => item.id === id);
    return user?.display_name || user?.email || '';
  }

  function positionName(position: Position): string {
    return position.occupant_display_name || userName(position.user_id) || 'Vacant position';
  }

  function positionTitle(position: Position): string {
    return position.title_override || roleName(position.role_id);
  }

  function positionVisibilityLabel(position: Position): string {
    if (position.visibility === 'internal') return 'Internal';
    if (!directoryEnabled) return 'Public · directory off';
    if (!eligiblePublicPositions.some((candidate) => candidate.id === position.id)) {
      return 'Public · needs attention';
    }
    return 'Public · live';
  }

  function childCount(layerId: string): number {
    return units.filter((unit) => unit.layer_id === layerId).length;
  }

  function positionCount(kind: 'unit' | 'role', id: string): number {
    return positions.filter((position) => kind === 'unit' ? position.unit_id === id : position.role_id === id).length;
  }

  function plural(count: number, singular: string, pluralWord = singular + 's'): string {
    return String(count) + ' ' + (count === 1 ? singular : pluralWord);
  }

  const resources = $derived.by<Resource[]>(() => {
    const list: Resource[] = [];
    for (const layer of layers) {
      list.push({
        key: 'layer-' + layer.id,
        kind: 'layer',
        label: layer.name,
        subtitle: layer.description || 'Organisation layer',
        meta: plural(childCount(layer.id), 'unit'),
        item: layer,
      });
    }
    for (const unit of units) {
      const parent = unit.parent_id ? unitName(unit.parent_id) : '';
      list.push({
        key: 'unit-' + unit.id,
        kind: 'unit',
        label: unit.name,
        subtitle: parent ? layerName(unit.layer_id) + ' · Reports to ' + parent : layerName(unit.layer_id),
        meta: plural(positionCount('unit', unit.id), 'position'),
        item: unit,
      });
    }
    for (const role of roles) {
      list.push({
        key: 'role-' + role.id,
        kind: 'role',
        label: role.title,
        subtitle: role.description || 'Reusable role definition',
        meta: plural(positionCount('role', role.id), 'position'),
        item: role,
      });
    }
    for (const position of positions) {
      list.push({
        key: 'position-' + position.id,
        kind: 'position',
        label: positionTitle(position),
        subtitle: positionName(position) + ' · ' + unitName(position.unit_id),
        meta: position.visibility === 'public'
          ? (directoryEnabled ? 'Public' : 'Public · paused')
          : 'Internal',
        item: position,
      });
    }
    return list;
  });

  const visibleResources = $derived.by(() => {
    const normalized = query.trim().toLowerCase();
    return resources.filter((resource) => {
      if (filter !== 'all' && resource.kind !== filter) return false;
      if (!normalized) return true;
      return [resource.label, resource.subtitle, resource.meta, resource.kind]
        .some((value) => value.toLowerCase().includes(normalized));
    });
  });

  const editorTitle = $derived(
    (editorMode === 'create' ? 'Add ' : 'Edit ') +
    (editorKind === 'role' ? 'role definition' : editorKind),
  );

  const editorDescription = $derived(
    editorKind === 'layer'
      ? 'Layers group units into broad levels, regions, or service tiers.'
      : editorKind === 'unit'
        ? 'Units are teams, departments, branches, or other parts of the organisation.'
        : editorKind === 'role'
          ? 'Role definitions are reusable titles that can be placed in one or more units.'
          : 'Positions connect a unit and role to an occupant and control public visibility.',
  );

  const editorAction = $derived(
    '?/' + (editorMode === 'create' ? 'create' : 'update') +
    (editorKind === 'role'
      ? 'Role'
      : editorKind.slice(0, 1).toUpperCase() + editorKind.slice(1)),
  );

  function openCreate(kind: ResourceKind): void {
    editorKind = kind;
    editorMode = 'create';
    selectedResource = null;
    positionVisibility = 'internal';
    positionUserId = '';
    positionWorkEmail = '';
    blade?.showModal();
    requestAnimationFrame(() => firstField?.focus());
  }

  function openEdit(resource: Resource): void {
    editorKind = resource.kind;
    editorMode = 'edit';
    selectedResource = resource;
    positionVisibility = resource.kind === 'position' ? resource.item.visibility : 'internal';
    positionUserId = resource.kind === 'position' ? resource.item.user_id || '' : '';
    positionWorkEmail = resource.kind === 'position' ? resource.item.work_email || '' : '';
    blade?.showModal();
    requestAnimationFrame(() => firstField?.focus());
  }

  function closeBlade(): void {
    blade?.close();
    selectedResource = null;
    positionVisibility = 'internal';
    positionUserId = '';
    positionWorkEmail = '';
  }

  function changePositionUser(event: Event): void {
    positionUserId = (event.currentTarget as HTMLSelectElement).value;
    if (!workMailboxes.some((mailbox) => mailbox.user_id === positionUserId && mailbox.address === positionWorkEmail)) {
      positionWorkEmail = '';
    }
  }

  function deleteAction(kind: ResourceKind): string {
    return '?/delete' + (kind === 'role' ? 'Role' : kind.slice(0, 1).toUpperCase() + kind.slice(1));
  }

  function itemId(resource: Resource): string {
    return resource.item.id;
  }

  function idField(kind: ResourceKind): string {
    return kind === 'role' ? 'role_id' : kind + '_id';
  }

  function confirmDelete(event: SubmitEvent): void {
    if (!window.confirm('Delete this resource? Related records may need to be removed first.')) {
      event.preventDefault();
    }
  }

  function confirmDirectoryToggle(event: SubmitEvent): void {
    if (directoryEnabled) return;
    const count = eligiblePublicPositions.length;
    const label = count === 1 ? '1 position' : `${count} positions`;
    if (!window.confirm(`Turn on the public directory? ${label} will be visible immediately with name, title, and work email.`)) {
      event.preventDefault();
    }
  }

  function kindLabel(kind: FilterKind): string {
    if (kind === 'all') return 'All';
    if (kind === 'role') return 'Roles';
    return kind.slice(0, 1).toUpperCase() + kind.slice(1) + 's';
  }

  function openResource(kind: ResourceKind, id: string): void {
    const resource = resources.find((candidate) => candidate.kind === kind && candidate.item.id === id);
    if (resource) openEdit(resource);
  }

  function toggleLayer(layerId: string): void {
    collapsedLayerIds = collapsedLayerIds.includes(layerId)
      ? collapsedLayerIds.filter((id) => id !== layerId)
      : [...collapsedLayerIds, layerId];
  }

  function toggleUnit(unitId: string): void {
    collapsedUnitIds = collapsedUnitIds.includes(unitId)
      ? collapsedUnitIds.filter((id) => id !== unitId)
      : [...collapsedUnitIds, unitId];
  }

  function expandHierarchy(): void {
    collapsedLayerIds = [];
    collapsedUnitIds = [];
  }

  function collapseHierarchy(): void {
    collapsedLayerIds = layers.map((layer) => layer.id);
    collapsedUnitIds = units.map((unit) => unit.id);
  }

  function showResourceFilter(kind: ResourceKind): void {
    filter = filter === kind && viewMode === 'resources' ? 'all' : kind;
    viewMode = 'resources';
  }
</script>

{#snippet renderUnitNodes(nodes: UnitTreeNode[])}
  <ul class="unit-tree">
    {#each nodes as node (node.unit.id)}
      {@const hasContents = node.children.length > 0 || node.positions.length > 0}
      {@const expanded = !collapsedUnitIds.includes(node.unit.id)}
      <li class="unit-branch">
        <div class="tree-node unit-node">
          {#if hasContents}
            <button
              type="button"
              class="tree-expander"
              aria-expanded={expanded}
              aria-controls={'unit-children-' + node.unit.id}
              onclick={() => toggleUnit(node.unit.id)}
            >
              <span class:expanded aria-hidden="true">›</span>
              <span class="sr-only">{expanded ? 'Collapse' : 'Expand'} {node.unit.name}</span>
            </button>
          {:else}
            <span class="tree-expander-spacer" aria-hidden="true"></span>
          {/if}
          <button
            type="button"
            class="tree-resource-button"
            onclick={() => openResource('unit', node.unit.id)}
            aria-label={'Edit unit ' + node.unit.name}
          >
            <span class="tree-symbol unit" aria-hidden="true">U</span>
            <span class="tree-resource-copy">
              <strong>{node.unit.name}</strong>
              <small>
                {node.parentOutsideLayer
                  ? 'Reports to ' + node.parentOutsideLayer + ' in another layer'
                  : node.unit.description || plural(node.positions.length, 'position')}
              </small>
            </span>
          </button>
          <span class="tree-count">{plural(node.positions.length, 'position')}</span>
        </div>

        {#if hasContents}
          <div id={'unit-children-' + node.unit.id} class="unit-children" hidden={!expanded}>
            {#if node.positions.length > 0}
              <ul class="position-tree" aria-label={'Positions in ' + node.unit.name}>
                {#each node.positions as position (position.id)}
                  {@const publicReady = eligiblePublicPositions.some((candidate) => candidate.id === position.id)}
                  <li>
                    <button
                      type="button"
                      class="tree-node position-node"
                      onclick={() => openResource('position', position.id)}
                      aria-label={'Edit position ' + positionTitle(position) + ', ' + positionName(position)}
                    >
                      <span class="tree-expander-spacer" aria-hidden="true"></span>
                      <span class="tree-symbol position" aria-hidden="true">P</span>
                      <span class="tree-resource-copy">
                        <strong>{positionTitle(position)}</strong>
                        <small>{positionName(position)}{position.work_email ? ' · ' + position.work_email : ''}</small>
                      </span>
                      <span
                        class="visibility-badge"
                        class:public={position.visibility === 'public'}
                        class:live={position.visibility === 'public' && directoryEnabled && publicReady}
                        class:attention={position.visibility === 'public' && directoryEnabled && !publicReady}
                      >{positionVisibilityLabel(position)}</span>
                      <span class="tree-edit-hint" aria-hidden="true">Edit</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
            {#if node.children.length > 0}
              {@render renderUnitNodes(node.children)}
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<svelte:head>
  <title>Organisation · Management · {data.appName || 'cmail'}</title>
</svelte:head>

<header class="page-heading">
  <div>
    <p class="eyebrow">Identity & organisation</p>
    <h1>Organisation</h1>
    <p>Model how your organisation works, then choose which positions can appear in a minimal public directory.</p>
  </div>
  <details class="add-menu">
    <summary class="btn btn-primary">Add resource <span aria-hidden="true">⌄</span></summary>
    <div class="add-menu-panel">
      <button type="button" onclick={() => openCreate('layer')}><strong>Layer</strong><small>A broad level or region</small></button>
      <button type="button" onclick={() => openCreate('unit')} disabled={layers.length === 0}><strong>Unit</strong><small>A team, branch, or department</small></button>
      <button type="button" onclick={() => openCreate('role')}><strong>Role definition</strong><small>A reusable position title</small></button>
      <button type="button" onclick={() => openCreate('position')} disabled={units.length === 0 || roles.length === 0}><strong>Position</strong><small>Place a role in a unit</small></button>
    </div>
  </details>
</header>

{#if form?.error}
  <div class="notice error" role="alert"><strong>Could not save.</strong> {form.error}</div>
{/if}
{#if form?.success}
  <div class="notice success" role="status">{form.success}</div>
{/if}

<section class:enabled={directoryEnabled} class="directory-control" aria-labelledby="directory-control-title">
  <div class="directory-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8">
      <circle cx="12" cy="8" r="3" />
      <path d="M5 20a7 7 0 0 1 14 0M4 4h16v16H4z" />
    </svg>
  </div>
  <div>
    <div class="control-title">
      <h2 id="directory-control-title">Public organisation directory</h2>
      <span class:live={directoryEnabled} class="state">{directoryEnabled ? 'On' : 'Off'}</span>
    </div>
    {#if directoryEnabled}
      <p>Only positions marked <strong>Public</strong> are included. The public endpoint returns the person's name, work email, and position title—nothing else.</p>
    {:else}
      <p>Public access is off. Every position remains private, including positions already marked Public. Review entries before switching this on.</p>
    {/if}
  </div>
  <form method="POST" action="?/toggleDirectory" onsubmit={confirmDirectoryToggle}>
    <input type="hidden" name="enabled" value={directoryEnabled ? 'false' : 'true'} />
    <button
      type="submit"
      class:active={directoryEnabled}
      class="master-switch"
      role="switch"
      aria-checked={directoryEnabled}
      aria-label={directoryEnabled ? 'Turn off the public organisation directory' : 'Turn on the public organisation directory'}
    >
      <span class="switch-track" aria-hidden="true"><span></span></span>
      <span>{directoryEnabled ? 'Turn off' : 'Turn on'}</span>
    </button>
  </form>
</section>

<aside class="privacy-boundary" aria-labelledby="privacy-boundary-title">
  <div class="privacy-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M12 3 5 6v5c0 4.7 2.8 8.1 7 10 4.2-1.9 7-5.3 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  </div>
  <div>
    <h2 id="privacy-boundary-title">Public directory privacy boundary</h2>
    <p><strong>Public means exactly three fields:</strong> occupant name, position title, and assigned work email. All other personal information, account data, permissions, reporting structure, and management notes stay internal.</p>
  </div>
  <span class="privacy-lock">Private by default</span>
</aside>

{#if !directoryEnabled && publicPositions.length > 0}
  <details class="directory-preflight card">
    <summary>Review publication preflight</summary>
    <div class="preflight-summary">
      <strong>{eligiblePublicPositions.length} ready to publish</strong>
      {#if ineligiblePublicCount > 0}<span>{ineligiblePublicCount} marked public but currently ineligible</span>{/if}
    </div>
    {#if eligiblePublicPositions.length > 0}
      <ul>
        {#each eligiblePublicPositions as position}
          <li><strong>{position.occupant_display_name}</strong><span>{positionTitle(position)} · {position.work_email}</span></li>
        {/each}
      </ul>
    {/if}
    <p>When enabled, the public surface is <code>/organization</code> and the minimal JSON projection is <code>/api/organization</code>. Units, hierarchy, user IDs, and all other personal information remain internal.</p>
  </details>
{/if}

{#if !hasStructure}
  <section class="first-run" aria-labelledby="first-run-title">
    <div class="first-run-copy">
      <span class="setup-badge">First-run setup</span>
      <h2 id="first-run-title">Build the organisation from the outside in</h2>
      <p>Start privately. Create a broad layer, add the units inside it, define reusable roles, then place those roles into units.</p>
    </div>
    <ol class="setup-steps">
      <li>
        <span>1</span>
        <div><strong>Create a layer</strong><small>For example: National, Regional, Operations.</small></div>
        <button type="button" class="btn" onclick={() => openCreate('layer')}>Create layer</button>
      </li>
      <li class:locked={layers.length === 0}>
        <span>2</span>
        <div><strong>Add a unit</strong><small>A team, office, branch, or department.</small></div>
        <button type="button" class="btn" onclick={() => openCreate('unit')} disabled={layers.length === 0}>Add unit</button>
      </li>
      <li>
        <span>3</span>
        <div><strong>Define a role</strong><small>Titles can be reused across multiple units.</small></div>
        <button type="button" class="btn" onclick={() => openCreate('role')}>Define role</button>
      </li>
      <li class:locked={units.length === 0 || roles.length === 0}>
        <span>4</span>
        <div><strong>Fill a position</strong><small>Visibility defaults to Internal.</small></div>
        <button type="button" class="btn" onclick={() => openCreate('position')} disabled={units.length === 0 || roles.length === 0}>Add position</button>
      </li>
    </ol>
  </section>
{:else}
  <section class="summary-grid" aria-label="Organisation resource summary">
    <button type="button" class:active={viewMode === 'resources' && filter === 'layer'} aria-pressed={viewMode === 'resources' && filter === 'layer'} onclick={() => showResourceFilter('layer')}>
      <span>{layers.length}</span><small>Layers</small>
    </button>
    <button type="button" class:active={viewMode === 'resources' && filter === 'unit'} aria-pressed={viewMode === 'resources' && filter === 'unit'} onclick={() => showResourceFilter('unit')}>
      <span>{units.length}</span><small>Units</small>
    </button>
    <button type="button" class:active={viewMode === 'resources' && filter === 'role'} aria-pressed={viewMode === 'resources' && filter === 'role'} onclick={() => showResourceFilter('role')}>
      <span>{roles.length}</span><small>Roles</small>
    </button>
    <button type="button" class:active={viewMode === 'resources' && filter === 'position'} aria-pressed={viewMode === 'resources' && filter === 'position'} onclick={() => showResourceFilter('position')}>
      <span>{positions.length}</span><small>Positions</small>
    </button>
  </section>
{/if}

{#if hasStructure}
  <div class="view-toolbar">
    <div class="view-switch" role="group" aria-label="Organisation view">
      <button type="button" class:active={viewMode === 'hierarchy'} aria-pressed={viewMode === 'hierarchy'} onclick={() => viewMode = 'hierarchy'}>
        <span aria-hidden="true">⌘</span> Hierarchy
      </button>
      <button type="button" class:active={viewMode === 'resources'} aria-pressed={viewMode === 'resources'} onclick={() => viewMode = 'resources'}>
        <span aria-hidden="true">☷</span> Resource inventory
      </button>
    </div>
    {#if viewMode === 'hierarchy' && units.length > 0}
      <div class="hierarchy-actions" role="group" aria-label="Hierarchy display">
        <button type="button" class="btn" onclick={expandHierarchy}>Expand all</button>
        <button type="button" class="btn" onclick={collapseHierarchy}>Collapse all</button>
      </div>
    {/if}
  </div>
{/if}

{#if viewMode === 'hierarchy'}
  <section class="hierarchy-section" aria-labelledby="hierarchy-title">
    <div class="section-heading">
      <div>
        <h2 id="hierarchy-title">Organisation hierarchy</h2>
        <p>Layers contain nested units; each unit contains its assigned positions. Select a resource to edit it.</p>
      </div>
      <div class="visibility-legend" aria-label="Position visibility legend">
        <span><i class="legend-dot internal"></i> Internal</span>
        <span><i class="legend-dot public"></i> Public</span>
      </div>
    </div>

    {#if hierarchy.length === 0}
      <div class="hierarchy-empty card">
        <span class="tree-symbol layer" aria-hidden="true">L</span>
        <div><h3>Create a layer to start the hierarchy</h3><p>Layers can represent levels, regions, service lines, or any other broad grouping.</p></div>
        <button type="button" class="btn btn-primary" onclick={() => openCreate('layer')}>Create layer</button>
      </div>
    {:else}
      <ul class="layer-tree" aria-label="Organisation layers">
        {#each hierarchy as layerTree (layerTree.layer.id)}
          {@const layerExpanded = !collapsedLayerIds.includes(layerTree.layer.id)}
          <li class="layer-branch">
            <div class="tree-node layer-node">
              <button
                type="button"
                class="tree-expander"
                aria-expanded={layerExpanded}
                aria-controls={'layer-children-' + layerTree.layer.id}
                onclick={() => toggleLayer(layerTree.layer.id)}
              >
                <span class:expanded={layerExpanded} aria-hidden="true">›</span>
                <span class="sr-only">{layerExpanded ? 'Collapse' : 'Expand'} {layerTree.layer.name}</span>
              </button>
              <button
                type="button"
                class="tree-resource-button"
                onclick={() => openResource('layer', layerTree.layer.id)}
                aria-label={'Edit layer ' + layerTree.layer.name}
              >
                <span class="tree-symbol layer" aria-hidden="true">L</span>
                <span class="tree-resource-copy">
                  <strong>{layerTree.layer.name}</strong>
                  <small>{layerTree.layer.description || 'Organisation layer'}</small>
                </span>
              </button>
              <span class="tree-count">{plural(layerTree.unitCount, 'unit')} · {plural(layerTree.positionCount, 'position')}</span>
            </div>
            <div id={'layer-children-' + layerTree.layer.id} class="layer-children" hidden={!layerExpanded}>
              {#if layerTree.roots.length > 0}
                {@render renderUnitNodes(layerTree.roots)}
              {:else}
                <div class="branch-empty">
                  <p><strong>No units in this layer</strong><span>Add a team, department, branch, or other organisational unit.</span></p>
                  <button type="button" class="btn" onclick={() => openCreate('unit')}>Add unit</button>
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

{#if viewMode === 'resources'}
<section class="resource-section" aria-labelledby="resources-title">
  <div class="resource-heading">
    <div>
      <h2 id="resources-title">Organisation resources</h2>
      <p>{plural(visibleResources.length, 'result')} shown</p>
    </div>
    <div class="search">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </svg>
      <label for="resource-search" class="sr-only">Search organisation resources</label>
      <input id="resource-search" type="search" bind:value={query} placeholder="Search units, roles, positions…" />
      {#if query}<button type="button" onclick={() => query = ''} aria-label="Clear search">×</button>{/if}
    </div>
  </div>

  <div class="filter-bar" aria-label="Filter resource type">
    {#each ['all', 'layer', 'unit', 'role', 'position'] as kind}
      <button
        type="button"
        class:active={filter === kind}
        aria-pressed={filter === kind}
        onclick={() => filter = kind as FilterKind}
      >{kindLabel(kind as FilterKind)}</button>
    {/each}
  </div>

  <div class="resource-list">
    <div class="list-head" aria-hidden="true">
      <span>Resource</span><span>Type</span><span>Details</span><span></span>
    </div>
    {#if visibleResources.length === 0}
      <div class="empty-results">
        <div aria-hidden="true">⌕</div>
        <h3>{resources.length === 0 ? 'No organisation resources yet' : 'No matching resources'}</h3>
        <p>{resources.length === 0 ? 'Use Add resource to begin with a layer or role definition.' : 'Try a different search or remove the current filter.'}</p>
        {#if resources.length === 0}
          <button type="button" class="btn btn-primary" onclick={() => openCreate('layer')}>Create the first layer</button>
        {:else}
          <button type="button" class="btn" onclick={() => { query = ''; filter = 'all'; }}>Clear filters</button>
        {/if}
      </div>
    {:else}
      <div role="list">
        {#each visibleResources as resource (resource.key)}
          <div role="listitem">
            <button type="button" class="resource-row" onclick={() => openEdit(resource)} aria-label={'Edit ' + resource.label}>
              <span class={'resource-symbol ' + resource.kind} aria-hidden="true">
                {resource.kind === 'layer' ? 'L' : resource.kind === 'unit' ? 'U' : resource.kind === 'role' ? 'R' : 'P'}
              </span>
              <span class="resource-primary">
                <strong>{resource.label}</strong>
                <small>{resource.subtitle}</small>
              </span>
              <span class="kind-pill">{resource.kind === 'role' ? 'Role definition' : resource.kind}</span>
              <span class:public={resource.kind === 'position' && resource.item.visibility === 'public'} class="resource-meta">{resource.meta}</span>
              <span class="chevron" aria-hidden="true">›</span>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>
{/if}

<dialog
  class="blade"
  bind:this={blade}
  aria-labelledby="blade-title"
  aria-describedby="blade-description"
  onclick={(event) => { if (event.target === blade) closeBlade(); }}
>
  <div class="blade-panel">
    <header class="blade-header">
      <div>
        <p>{editorMode === 'create' ? 'New resource' : 'Resource settings'}</p>
        <h2 id="blade-title">{editorTitle}</h2>
      </div>
      <button type="button" class="close-button" onclick={closeBlade} aria-label="Close editing panel">×</button>
    </header>

    <p id="blade-description" class="blade-description">{editorDescription}</p>

    <form method="POST" action={editorAction} class="blade-form">
      {#if editorMode === 'edit' && selectedResource}
        <input type="hidden" name={idField(editorKind)} value={itemId(selectedResource)} />
      {/if}

      {#if editorKind === 'layer'}
        <label>
          <span>Name</span>
          <input bind:this={firstField} name="name" required maxlength="120" value={selectedLayer?.name || ''} placeholder="Regional operations" />
        </label>
        <label>
          <span>Description <small>Optional</small></span>
          <textarea name="description" maxlength="500" rows="4" placeholder="What belongs in this layer?">{selectedLayer?.description || ''}</textarea>
        </label>
        <label class="short-field">
          <span>Display order</span>
          <input name="sort_order" type="number" min="0" max="9999" value={selectedLayer?.sort_order ?? 0} />
        </label>
      {:else if editorKind === 'unit'}
        <label>
          <span>Name</span>
          <input bind:this={firstField} name="name" required maxlength="120" value={selectedUnit?.name || ''} placeholder="Customer operations" />
        </label>
        <label>
          <span>Layer</span>
          <select name="layer_id" required value={selectedUnit?.layer_id || ''}>
            <option value="">Select a layer</option>
            {#each layers as layer}<option value={layer.id}>{layer.name}</option>{/each}
          </select>
        </label>
        <label>
          <span>Parent unit <small>Optional</small></span>
          <select name="parent_id" value={selectedUnit?.parent_id || ''}>
            <option value="">No parent unit</option>
            {#each units.filter((unit) => unit.id !== selectedUnit?.id) as unit}
              <option value={unit.id}>{unit.name} · {layerName(unit.layer_id)}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Description <small>Optional</small></span>
          <textarea name="description" maxlength="500" rows="4" placeholder="Purpose and scope of this unit">{selectedUnit?.description || ''}</textarea>
        </label>
        <label class="short-field">
          <span>Display order</span>
          <input name="sort_order" type="number" min="0" max="9999" value={selectedUnit?.sort_order ?? 0} />
        </label>
      {:else if editorKind === 'role'}
        <label>
          <span>Role title</span>
          <input bind:this={firstField} name="title" required maxlength="120" value={selectedRole?.title || ''} placeholder="Service manager" />
        </label>
        <label>
          <span>Description <small>Optional</small></span>
          <textarea name="description" maxlength="500" rows="4" placeholder="Purpose and responsibilities">{selectedRole?.description || ''}</textarea>
        </label>
        <label class="short-field">
          <span>Display order</span>
          <input name="sort_order" type="number" min="0" max="9999" value={selectedRole?.sort_order ?? 0} />
        </label>
      {:else}
        <div class="form-grid">
          <label>
            <span>Unit</span>
            <select bind:this={firstField} name="unit_id" required value={selectedPosition?.unit_id || ''}>
              <option value="">Select a unit</option>
              {#each units as unit}<option value={unit.id}>{unit.name} · {layerName(unit.layer_id)}</option>{/each}
            </select>
          </label>
          <label>
            <span>Role definition</span>
            <select name="role_id" required value={selectedPosition?.role_id || ''}>
              <option value="">Select a role</option>
              {#each roles as role}<option value={role.id}>{role.title}</option>{/each}
            </select>
          </label>
        </div>
        <label>
          <span>Position title override <small>Optional</small></span>
          <input name="title_override" maxlength="120" value={selectedPosition?.title_override || ''} placeholder="Uses the role title when blank" />
        </label>
        <label>
          <span>Linked user <small>{positionVisibility === 'public' ? 'Required for public entries' : 'Optional'}</small></span>
          <select
            name="user_id"
            required={positionVisibility === 'public'}
            value={positionUserId}
            onchange={changePositionUser}
          >
            <option value="">No linked account</option>
            {#each users as user}<option value={user.id}>{user.display_name || user.email} · {user.email}</option>{/each}
          </select>
          <small class="field-help">Linking a user does not change mailbox or admin permissions.</small>
        </label>
        <label>
          <span>Occupant display name <small>{positionVisibility === 'public' ? 'Required for public entries' : 'Optional'}</small></span>
          <input
            name="occupant_display_name"
            maxlength="120"
            required={positionVisibility === 'public'}
            value={selectedPosition?.occupant_display_name || ''}
            placeholder="Name shown for this position"
          />
        </label>
        <label>
          <span>Work email <small>{positionVisibility === 'public' ? 'Required for public entries' : 'Optional'}</small></span>
          <select
            name="work_email"
            required={positionVisibility === 'public'}
            disabled={!positionUserId}
            bind:value={positionWorkEmail}
          >
            <option value="">No work email</option>
            {#each eligibleWorkMailboxes as mailbox}
              <option value={mailbox.address}>{mailbox.address}{mailbox.display_name ? ' · ' + mailbox.display_name : ''}</option>
            {/each}
          </select>
          <small class="field-help">
            {#if !positionUserId}
              Select a linked user before choosing a work email.
            {:else if eligibleWorkMailboxes.length === 0}
              This user has no active work mailbox. Add one before making the position public.
            {:else}
              Only active work mailboxes assigned to the linked user can be published.
            {/if}
          </small>
        </label>

        <fieldset class="visibility-field">
          <legend>Directory visibility</legend>
          <label class:checked={positionVisibility === 'internal'} class="visibility-option">
            <input type="radio" name="visibility" value="internal" bind:group={positionVisibility} />
            <span class="radio-mark" aria-hidden="true"></span>
            <span><strong>Internal</strong><small>Private by default; omitted from the public endpoint.</small></span>
          </label>
          <label class:checked={positionVisibility === 'public'} class="visibility-option">
            <input type="radio" name="visibility" value="public" bind:group={positionVisibility} />
            <span class="radio-mark" aria-hidden="true"></span>
            <span><strong>Public</strong><small>Eligible for the public directory when the master switch is on.</small></span>
          </label>
        </fieldset>

        <div class:public={positionVisibility === 'public'} class="privacy-copy">
          <strong>{positionVisibility === 'public' ? 'What the public can see' : 'This position stays private'}</strong>
          <p>
            {positionVisibility === 'public'
              ? 'Only the occupant name, work email, and position title are returned publicly. Unit structure, linked account, permissions, and internal fields are not exposed.'
              : 'Internal positions are stored for management and are never returned by the public directory endpoint.'}
          </p>
        </div>

        <label class="short-field">
          <span>Display order</span>
          <input name="sort_order" type="number" min="0" max="9999" value={selectedPosition?.sort_order ?? 0} />
        </label>
      {/if}

      <footer class="blade-actions">
        <button type="button" class="btn" onclick={closeBlade}>Cancel</button>
        <button type="submit" class="btn btn-primary">{editorMode === 'create' ? 'Create' : 'Save changes'}</button>
      </footer>
    </form>

    {#if editorMode === 'edit' && selectedResource}
      <div class="danger-zone">
        <div><strong>Delete resource</strong><p>Deletion can be blocked while another resource depends on this one.</p></div>
        <form method="POST" action={deleteAction(editorKind)} onsubmit={confirmDelete}>
          <input type="hidden" name={idField(editorKind)} value={itemId(selectedResource)} />
          <button type="submit" class="btn btn-danger">Delete</button>
        </form>
      </div>
    {/if}
  </div>
</dialog>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .page-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 20px;
  }
  .page-heading h1 { margin: 2px 0 7px; font-size: clamp(26px, 4vw, 34px); letter-spacing: -.03em; }
  .page-heading p:last-child { max-width: 720px; color: var(--text-muted); }
  .eyebrow {
    margin: 0;
    color: var(--primary);
    font-size: 11px;
    font-weight: 750;
    letter-spacing: .09em;
    text-transform: uppercase;
  }
  .add-menu { position: relative; flex: 0 0 auto; }
  .add-menu summary { list-style: none; min-height: 40px; }
  .add-menu summary::-webkit-details-marker { display: none; }
  .add-menu-panel {
    position: absolute;
    z-index: 15;
    top: calc(100% + 8px);
    right: 0;
    width: 286px;
    padding: 7px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    box-shadow: var(--shadow-lg);
  }
  .add-menu-panel button {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-height: 54px;
    padding: 9px 11px;
    border-color: transparent;
    background: transparent;
    white-space: normal;
    text-align: left;
  }
  .add-menu-panel button:hover { background: var(--bg-hover); }
  .add-menu-panel button small { color: var(--text-muted); font-size: 11px; }
  .notice {
    margin-bottom: 14px;
    padding: 11px 14px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    font-size: 13px;
  }
  .notice.error { border-color: color-mix(in srgb, var(--danger) 28%, transparent); background: var(--danger-soft); color: var(--danger); }
  .notice.success { border-color: color-mix(in srgb, var(--success) 28%, transparent); background: var(--success-soft); color: var(--success); }
  .directory-control {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    gap: 14px;
    align-items: center;
    padding: 16px;
    border: 1px solid var(--border);
    border-left: 4px solid var(--text-faint);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    box-shadow: var(--shadow-sm);
  }
  .directory-control.enabled { border-left-color: var(--success); }
  .directory-icon {
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: var(--bg-hover);
    color: var(--text-muted);
  }
  .directory-control.enabled .directory-icon { background: var(--success-soft); color: var(--success); }
  .control-title { display: flex; align-items: center; gap: 8px; }
  .control-title h2 { margin: 0; font-size: 15px; }
  .directory-control p { margin: 3px 0 0; max-width: 820px; color: var(--text-muted); font-size: 12px; }
  .privacy-boundary {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    margin-top: 10px;
    padding: 12px 14px;
    border: 1px solid color-mix(in srgb, var(--primary) 20%, var(--border));
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--primary-soft) 45%, var(--bg-surface));
  }
  .privacy-icon {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 9px;
    background: var(--primary-soft);
    color: var(--primary);
  }
  .privacy-boundary h2 { margin: 0 0 2px; font-size: 13px; }
  .privacy-boundary p { margin: 0; color: var(--text-muted); font-size: 11px; }
  .privacy-lock {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-surface);
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }
  .directory-preflight { margin-top: -8px; padding: 0; overflow: hidden; }
  .directory-preflight summary { padding: 13px 16px; cursor: pointer; font-size: 13px; font-weight: 650; }
  .directory-preflight[open] summary { border-bottom: 1px solid var(--border); }
  .preflight-summary { display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 14px 16px 0; font-size: 12px; }
  .preflight-summary span { color: var(--warning); }
  .directory-preflight ul { display: grid; gap: 0; margin: 12px 16px; padding: 0; list-style: none; border: 1px solid var(--border); border-radius: var(--radius); }
  .directory-preflight li { display: flex; justify-content: space-between; gap: 12px; padding: 9px 11px; border-bottom: 1px solid var(--border); font-size: 12px; }
  .directory-preflight li:last-child { border-bottom: 0; }
  .directory-preflight li span { color: var(--text-muted); text-align: right; overflow-wrap: anywhere; }
  .directory-preflight > p { margin: 0; padding: 0 16px 15px; color: var(--text-muted); font-size: 11px; }
  .state {
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--bg-active);
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 750;
    text-transform: uppercase;
  }
  .state.live { background: var(--success-soft); color: var(--success); }
  .master-switch {
    border-color: transparent;
    background: transparent;
    color: var(--text-muted);
  }
  .master-switch:hover { border-color: var(--border); }
  .switch-track {
    width: 38px;
    height: 21px;
    display: inline-flex;
    align-items: center;
    padding: 2px;
    border-radius: 999px;
    background: var(--border-strong);
    transition: background .15s ease;
  }
  .switch-track span {
    width: 17px;
    height: 17px;
    border-radius: 50%;
    background: white;
    box-shadow: 0 1px 3px rgba(0,0,0,.22);
    transition: transform .15s ease;
  }
  .master-switch.active .switch-track { background: var(--success); }
  .master-switch.active .switch-track span { transform: translateX(17px); }
  .first-run {
    display: grid;
    grid-template-columns: minmax(220px, .7fr) minmax(0, 1.3fr);
    gap: 30px;
    margin-top: 18px;
    padding: 26px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: linear-gradient(135deg, var(--primary-soft), var(--bg-surface) 52%);
  }
  .setup-badge {
    display: inline-block;
    margin-bottom: 13px;
    padding: 4px 8px;
    border-radius: 999px;
    background: var(--primary);
    color: var(--on-primary);
    font-size: 10px;
    font-weight: 750;
    letter-spacing: .05em;
    text-transform: uppercase;
  }
  .first-run h2 { margin: 0 0 9px; max-width: 360px; font-size: 23px; }
  .first-run-copy p { color: var(--text-muted); font-size: 13px; }
  .setup-steps { display: flex; flex-direction: column; gap: 7px; list-style: none; }
  .setup-steps li {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    gap: 11px;
    align-items: center;
    padding: 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-surface);
  }
  .setup-steps li > span {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--primary-soft);
    color: var(--primary);
    font-size: 12px;
    font-weight: 750;
  }
  .setup-steps li > div { display: flex; flex-direction: column; }
  .setup-steps strong { font-size: 13px; }
  .setup-steps small { color: var(--text-muted); font-size: 11px; }
  .setup-steps .locked { opacity: .63; }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin-top: 18px;
  }
  .summary-grid button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-height: 72px;
    padding: 12px 14px;
    background: var(--bg-surface);
  }
  .summary-grid button.active { border-color: var(--primary); background: var(--primary-soft); }
  .summary-grid span { font-size: 22px; font-weight: 700; letter-spacing: -.03em; }
  .summary-grid small { color: var(--text-muted); }
  .view-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 18px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
  }
  .view-switch {
    display: inline-flex;
    gap: 3px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-subtle);
  }
  .view-switch button {
    min-height: 34px;
    padding: 6px 11px;
    border-color: transparent;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
  }
  .view-switch button.active {
    border-color: var(--border);
    background: var(--bg-surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
  .hierarchy-actions { display: flex; gap: 6px; }
  .hierarchy-actions .btn { min-height: 32px; padding: 5px 10px; font-size: 11px; }
  .hierarchy-section { margin-top: 20px; }
  .section-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 10px;
  }
  .section-heading h2 { margin: 0; font-size: 18px; }
  .section-heading p { margin: 3px 0 0; color: var(--text-muted); font-size: 12px; }
  .visibility-legend { display: flex; gap: 12px; color: var(--text-muted); font-size: 10px; white-space: nowrap; }
  .visibility-legend span { display: inline-flex; align-items: center; gap: 5px; }
  .legend-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-faint); }
  .legend-dot.public { background: var(--primary); }
  .hierarchy-empty {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr) auto;
    gap: 13px;
    align-items: center;
    padding: 22px;
  }
  .hierarchy-empty h3 { margin: 0; font-size: 14px; }
  .hierarchy-empty p { margin: 3px 0 0; color: var(--text-muted); font-size: 11px; }
  .layer-tree, .unit-tree, .position-tree {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .layer-tree { display: grid; gap: 10px; }
  .layer-branch {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    box-shadow: var(--shadow-sm);
  }
  .tree-node {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }
  .layer-node { min-height: 68px; padding: 9px 14px; background: var(--bg-subtle); }
  .unit-node { min-height: 61px; padding: 7px 14px 7px 10px; }
  .unit-branch + .unit-branch { border-top: 1px solid var(--border); }
  .tree-expander, .tree-expander-spacer {
    width: 30px;
    height: 30px;
    min-height: 30px;
  }
  .tree-expander {
    padding: 0;
    border-color: transparent;
    background: transparent;
    color: var(--text-muted);
  }
  .tree-expander:hover { background: var(--bg-hover); }
  .tree-expander > span:first-child {
    display: inline-block;
    font-size: 22px;
    line-height: 1;
    transform: rotate(0deg);
    transition: transform .15s ease;
  }
  .tree-expander > span.expanded { transform: rotate(90deg); }
  .tree-resource-button {
    width: 100%;
    min-width: 0;
    min-height: 44px;
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    padding: 4px 7px;
    border-color: transparent;
    background: transparent;
    color: var(--text);
    text-align: left;
    white-space: normal;
  }
  .tree-resource-button:hover { background: var(--bg-hover); }
  .tree-symbol {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: var(--bg-active);
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 800;
  }
  .tree-symbol.layer { background: #ede9fe; color: #6d28d9; }
  .tree-symbol.unit { background: #dbeafe; color: #1d4ed8; }
  .tree-symbol.position { background: #dcfce7; color: #15803d; }
  .tree-resource-copy { min-width: 0; display: flex; flex-direction: column; }
  .tree-resource-copy strong, .tree-resource-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tree-resource-copy strong { font-size: 13px; }
  .tree-resource-copy small { color: var(--text-muted); font-size: 10px; }
  .tree-count { color: var(--text-muted); font-size: 10px; white-space: nowrap; }
  .layer-children { border-top: 1px solid var(--border); }
  .layer-children > .unit-tree > .unit-branch > .unit-children {
    margin-left: 24px;
    border-left: 1px solid var(--border);
  }
  .unit-children > .unit-tree { margin-left: 24px; border-left: 1px solid var(--border); }
  .position-tree { margin-left: 38px; border-left: 1px dashed var(--border); }
  .position-tree li + li { border-top: 1px solid var(--border); }
  .position-node {
    width: 100%;
    grid-template-columns: 22px 30px minmax(180px, 1fr) auto 34px;
    min-height: 55px;
    padding: 6px 14px 6px 9px;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    white-space: normal;
  }
  .position-node:hover { background: var(--bg-hover); }
  .position-node .tree-expander-spacer { width: 22px; }
  .visibility-badge {
    justify-self: end;
    padding: 3px 7px;
    border-radius: 999px;
    background: var(--bg-active);
    color: var(--text-muted);
    font-size: 9px;
    font-weight: 700;
    white-space: nowrap;
  }
  .visibility-badge.public { background: var(--primary-soft); color: var(--primary); }
  .visibility-badge.live { background: var(--success-soft); color: var(--success); }
  .visibility-badge.attention { background: var(--warning-soft); color: var(--warning); }
  .tree-edit-hint { color: var(--text-faint); font-size: 9px; opacity: 0; }
  .position-node:hover .tree-edit-hint, .position-node:focus-visible .tree-edit-hint { opacity: 1; }
  .branch-empty {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 16px 18px 16px 52px;
  }
  .branch-empty p { display: flex; flex-direction: column; margin: 0; }
  .branch-empty strong { font-size: 12px; }
  .branch-empty span { color: var(--text-muted); font-size: 10px; }
  .resource-section { margin-top: 22px; }
  .resource-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 10px;
  }
  .resource-heading h2 { margin: 0; font-size: 18px; }
  .resource-heading p { margin: 3px 0 0; color: var(--text-muted); font-size: 12px; }
  .search {
    width: min(100%, 380px);
    position: relative;
    display: flex;
    align-items: center;
  }
  .search > svg { position: absolute; left: 11px; color: var(--text-muted); pointer-events: none; }
  .search input { padding-left: 36px; padding-right: 36px; }
  .search button {
    position: absolute;
    right: 5px;
    width: 30px;
    min-height: 30px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    font-size: 20px;
  }
  .filter-bar {
    display: flex;
    gap: 5px;
    overflow-x: auto;
    padding: 1px 0 10px;
  }
  .filter-bar button {
    min-height: 32px;
    padding: 5px 11px;
    border-color: transparent;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
  }
  .filter-bar button.active { background: var(--primary-soft); color: var(--primary); }
  .resource-list {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    box-shadow: var(--shadow-sm);
  }
  .list-head, .resource-row {
    display: grid;
    grid-template-columns: 34px minmax(260px, 1.4fr) minmax(120px, .45fr) minmax(130px, .5fr) 22px;
    gap: 12px;
    align-items: center;
  }
  .list-head {
    min-height: 36px;
    padding: 7px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-subtle);
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .06em;
    text-transform: uppercase;
  }
  .list-head span:first-child { grid-column: 2; }
  .resource-row {
    width: 100%;
    min-height: 67px;
    padding: 10px 14px;
    border: 0;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    white-space: normal;
  }
  [role="listitem"]:last-child .resource-row { border-bottom: 0; }
  .resource-row:hover { background: var(--bg-hover); }
  .resource-symbol {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: var(--bg-active);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 800;
  }
  .resource-symbol.layer { background: #ede9fe; color: #6d28d9; }
  .resource-symbol.unit { background: #dbeafe; color: #1d4ed8; }
  .resource-symbol.role { background: #fef3c7; color: #a16207; }
  .resource-symbol.position { background: #dcfce7; color: #15803d; }
  .resource-primary { min-width: 0; display: flex; flex-direction: column; }
  .resource-primary strong, .resource-primary small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .resource-primary strong { font-size: 13px; }
  .resource-primary small { color: var(--text-muted); font-size: 11px; }
  .kind-pill, .resource-meta {
    justify-self: start;
    padding: 3px 7px;
    border-radius: 999px;
    background: var(--bg-hover);
    color: var(--text-muted);
    font-size: 10px;
    text-transform: capitalize;
  }
  .resource-meta.public { background: var(--success-soft); color: var(--success); }
  .chevron { justify-self: end; color: var(--text-faint); font-size: 21px; }
  .empty-results {
    display: grid;
    justify-items: center;
    padding: 44px 20px;
    text-align: center;
  }
  .empty-results > div {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    margin-bottom: 10px;
    border-radius: 50%;
    background: var(--bg-hover);
    color: var(--text-muted);
    font-size: 24px;
  }
  .empty-results h3 { font-size: 15px; }
  .empty-results p { max-width: 430px; margin: 5px 0 14px; color: var(--text-muted); font-size: 12px; }
  .blade {
    width: min(560px, 100%);
    max-width: none;
    height: 100dvh;
    max-height: none;
    margin: 0 0 0 auto;
    padding: 0;
    border: 0;
    border-left: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }
  .blade::backdrop { background: rgba(15, 23, 42, .42); backdrop-filter: blur(2px); }
  .blade-panel {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    background: var(--bg-surface);
  }
  .blade-header {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    min-height: 74px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface);
  }
  .blade-header p { margin: 0 0 2px; color: var(--text-muted); font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
  .blade-header h2 { margin: 0; font-size: 20px; }
  .close-button {
    width: 36px;
    height: 36px;
    min-height: 36px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    font-size: 24px;
    font-weight: 300;
  }
  .blade-description { margin: 0; padding: 16px 20px 0; color: var(--text-muted); font-size: 12px; }
  .blade-form { display: flex; flex-direction: column; gap: 16px; padding: 20px; }
  .blade-form label { display: flex; flex-direction: column; gap: 6px; color: var(--text); font-size: 12px; font-weight: 600; }
  .blade-form label > span { display: flex; justify-content: space-between; gap: 8px; }
  .blade-form label span small { color: var(--text-muted); font-weight: 400; }
  .field-help { color: var(--text-muted); font-size: 10px; font-weight: 400; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .short-field { max-width: 180px; }
  .visibility-field { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; padding: 0; border: 0; }
  .visibility-field legend { grid-column: 1 / -1; margin-bottom: 6px; font-size: 12px; font-weight: 600; }
  .visibility-option {
    display: grid !important;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 9px !important;
    align-items: flex-start;
    min-height: 82px;
    padding: 11px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-subtle);
    cursor: pointer;
  }
  .visibility-option.checked { border-color: var(--primary); background: var(--primary-soft); }
  .visibility-option input { position: absolute; opacity: 0; pointer-events: none; }
  .visibility-option > span:last-child { display: flex; flex-direction: column; }
  .visibility-option strong { font-size: 12px; }
  .visibility-option small { margin-top: 3px; color: var(--text-muted); font-size: 10px; font-weight: 400; }
  .radio-mark {
    width: 16px;
    height: 16px;
    margin-top: 2px;
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    background: var(--bg-surface);
    box-shadow: inset 0 0 0 4px var(--bg-surface);
  }
  .visibility-option.checked .radio-mark { border-color: var(--primary); background: var(--primary); }
  .visibility-option:focus-within { outline: 2px solid var(--primary); outline-offset: 2px; }
  .privacy-copy {
    padding: 12px 14px;
    border-left: 3px solid var(--text-faint);
    border-radius: var(--radius);
    background: var(--bg-subtle);
  }
  .privacy-copy.public { border-left-color: var(--success); background: var(--success-soft); }
  .privacy-copy strong { font-size: 12px; }
  .privacy-copy p { margin: 4px 0 0; color: var(--text-muted); font-size: 11px; }
  .blade-actions {
    position: sticky;
    bottom: 0;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin: 4px -20px -20px;
    padding: 13px 20px;
    border-top: 1px solid var(--border);
    background: var(--bg-surface);
  }
  .danger-zone {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin: 0 20px 24px;
    padding: 14px;
    border: 1px solid color-mix(in srgb, var(--danger) 25%, var(--border));
    border-radius: var(--radius);
    background: var(--danger-soft);
  }
  .danger-zone strong { color: var(--danger); font-size: 12px; }
  .danger-zone p { margin: 3px 0 0; color: var(--text-muted); font-size: 10px; }
  @media (prefers-color-scheme: dark) {
    .tree-symbol.layer,
    .resource-symbol.layer { background: #2e2052; color: #c4b5fd; }
    .tree-symbol.unit,
    .resource-symbol.unit { background: #172c4d; color: #93c5fd; }
    .resource-symbol.role { background: #3d2d10; color: #fcd34d; }
    .tree-symbol.position,
    .resource-symbol.position { background: #14301f; color: #86efac; }
  }
  @media (max-width: 760px) {
    .page-heading { align-items: stretch; }
    .directory-control { grid-template-columns: 38px minmax(0, 1fr); }
    .directory-control form { grid-column: 1 / -1; }
    .master-switch { width: 100%; justify-content: flex-start; }
    .first-run { grid-template-columns: 1fr; padding: 20px; }
    .summary-grid { grid-template-columns: 1fr 1fr; }
    .privacy-boundary { grid-template-columns: 34px minmax(0, 1fr); }
    .privacy-lock { grid-column: 2; justify-self: start; }
    .view-toolbar, .section-heading { align-items: stretch; flex-direction: column; }
    .view-switch { width: 100%; }
    .view-switch button { flex: 1; }
    .hierarchy-actions .btn { flex: 1; }
    .visibility-legend { justify-content: flex-start; }
    .tree-count { display: none; }
    .position-node { grid-template-columns: 12px 30px minmax(120px, 1fr) auto; }
    .position-node .tree-expander-spacer { width: 12px; }
    .tree-edit-hint { display: none; }
    .position-tree { margin-left: 24px; }
    .resource-heading { align-items: stretch; flex-direction: column; }
    .search { width: 100%; }
    .list-head { display: none; }
    .resource-row {
      grid-template-columns: 34px minmax(0, 1fr) 20px;
      gap: 10px;
      min-height: 76px;
    }
    .resource-primary { grid-column: 2; }
    .kind-pill { grid-column: 2; grid-row: 2; }
    .resource-meta { grid-column: 2; grid-row: 2; margin-left: 88px; }
    .chevron { grid-column: 3; grid-row: 1 / span 2; }
    .form-grid, .visibility-field { grid-template-columns: 1fr; }
    .blade { width: min(100%, 520px); }
  }
  @media (max-width: 520px) {
    .page-heading { flex-direction: column; }
    .add-menu summary { width: 100%; }
    .add-menu-panel { left: 0; right: auto; width: 100%; }
    .setup-steps li { grid-template-columns: 30px minmax(0, 1fr); }
    .setup-steps li button { grid-column: 1 / -1; width: 100%; }
    .hierarchy-empty { grid-template-columns: 34px minmax(0, 1fr); }
    .hierarchy-empty .btn { grid-column: 1 / -1; width: 100%; }
    .layer-node, .unit-node { padding-left: 7px; padding-right: 8px; }
    .tree-node { gap: 4px; }
    .position-node {
      grid-template-columns: 28px minmax(0, 1fr);
      padding: 8px;
    }
    .position-node .tree-expander-spacer { display: none; }
    .position-node .tree-symbol { grid-column: 1; grid-row: 1 / span 2; }
    .position-node .tree-resource-copy { grid-column: 2; }
    .position-node .visibility-badge { grid-column: 2; justify-self: start; }
    .layer-children > .unit-tree > .unit-branch > .unit-children,
    .unit-children > .unit-tree { margin-left: 12px; }
    .position-tree { margin-left: 12px; }
    .branch-empty { padding-left: 20px; flex-direction: column; align-items: stretch; }
    .blade { width: 100%; }
    .blade-header { padding: 12px 15px; }
    .blade-description { padding: 14px 15px 0; }
    .blade-form { padding: 16px 15px; }
    .blade-actions { margin: 4px -15px -16px; padding: 12px 15px; }
    .danger-zone { margin: 0 15px 20px; flex-direction: column; align-items: stretch; }
  }
</style>
