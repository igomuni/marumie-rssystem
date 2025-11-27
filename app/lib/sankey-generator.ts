import * as fs from 'fs';
import * as path from 'path';
import type { RS2024StructuredData, BudgetRecord, SpendingRecord } from '@/types/structured';
import type {
  RS2024PresetData,
  SankeyNode,
  SankeyLink,
} from '@/types/preset';

// Cache the data in memory to avoid re-reading the large JSON file
let cachedData: RS2024StructuredData | null = null;

interface GenerateOptions {
  ministryOffset?: number;
  projectOffset?: number;
  ministryLimit?: number;
  projectLimit?: number;
  spendingLimit?: number;
  targetMinistryName?: string;
  targetProjectName?: string;
  targetRecipientName?: string;
}

export async function generateSankeyData(options: GenerateOptions = {}): Promise<RS2024PresetData> {
  const {
    ministryOffset = 0,
    projectOffset = 0,
    ministryLimit = 3,
    projectLimit = 3,
    spendingLimit = 5,
    targetMinistryName,
    targetProjectName,
    targetRecipientName,
  } = options;

  // 1. Load data
  if (!cachedData) {
    const dataPath = path.join(process.cwd(), 'public/data/rs2024-structured.json');
    try {
      const rawData = fs.readFileSync(dataPath, 'utf-8');
      cachedData = JSON.parse(rawData);
    } catch (error) {
      console.error('Failed to load structured data:', error);
      throw new Error('Failed to load data source');
    }
  }
  const fullData = cachedData!;

  // 2. Select Data
  const selection = selectData(fullData, {
    offset: ministryOffset,
    projectOffset,
    limit: ministryLimit,
    projectLimit,
    spendingLimit,
    targetMinistryName,
    targetProjectName,
    targetRecipientName,
  });

  // 3. Build Sankey Data
  const sankeyData = buildSankeyData(
    selection,
    fullData,
    {
      offset: ministryOffset,
      targetMinistryName,
      targetProjectName,
      targetRecipientName,
    }
  );

  // 4. Generate Metadata
  // Calculate selected budget based on view type
  let selectedBudget = 0;
  if (targetRecipientName) {
    // For spending view, sum of selected projects
    selectedBudget = selection.topProjects.reduce((sum, p) => sum + p.totalBudget, 0);
  } else {
    selectedBudget = selection.topProjects.reduce((sum, p) => sum + p.totalBudget, 0);
  }

  const coverageRate = (selectedBudget / fullData.metadata.totalBudgetAmount) * 100;

  let presetType = 'global';
  if (targetMinistryName) presetType = 'ministry';
  if (targetProjectName) presetType = 'project';
  if (targetRecipientName) presetType = 'spending';

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      fiscalYear: 2024,
      presetType,
      sourceFile: 'rs2024-structured.json',
      filterSettings: {
        topMinistries: ministryLimit,
        topProjects: projectLimit,
        topSpendings: spendingLimit,
        sortBy: 'budget',
      },
      summary: {
        totalMinistries: fullData.budgetTree.ministries.length,
        totalProjects: fullData.metadata.totalProjects,
        totalSpendings: fullData.metadata.totalRecipients,
        selectedMinistries: selection.topMinistries.length,
        selectedProjects: selection.topProjects.length,
        selectedSpendings: selection.topSpendings.length,
        totalBudget: fullData.metadata.totalBudgetAmount,
        selectedBudget: selectedBudget,
        coverageRate: coverageRate,
      },
    },
    sankey: sankeyData,
  };
}

interface DataSelection {
  topMinistries: Array<{ name: string; id: number; totalBudget: number; bureauCount: number }>;
  otherMinistriesBudget: number;
  otherMinistriesSpending: number; // Spending amount for "Other Ministries"
  topProjects: BudgetRecord[];
  otherProjectsBudgetByMinistry: Map<string, number>;
  otherProjectsSpendingByMinistry: Map<string, number>; // Spending amount for "Other Projects"
  topSpendings: SpendingRecord[];
  otherSpendingsByProject: Map<number, number>;
  otherNamedSpendingByProject: Map<number, number>;
}

function selectData(
  data: RS2024StructuredData,
  options: {
    offset: number;
    projectOffset: number;
    limit: number;
    projectLimit: number;
    spendingLimit: number;
    targetMinistryName?: string;
    targetProjectName?: string;
    targetRecipientName?: string;
  }
): DataSelection {
  const { offset, projectOffset, limit, projectLimit, spendingLimit, targetMinistryName, targetProjectName, targetRecipientName } = options;

  // Initialize result containers
  let topMinistries: Array<{ name: string; id: number; totalBudget: number; bureauCount: number }> = [];
  let otherMinistriesBudget = 0;
  let otherMinistriesSpending = 0;
  let topProjects: BudgetRecord[] = [];
  const otherProjectsBudgetByMinistry = new Map<string, number>();
  const otherProjectsSpendingByMinistry = new Map<string, number>();
  let topSpendings: SpendingRecord[] = [];
  const otherSpendingsByProject = new Map<number, number>();
  const otherNamedSpendingByProject = new Map<number, number>();

  if (targetRecipientName) {
    // --- Spending View (Reverse Flow) ---
    // 1. Find Recipient
    // Note: Since we don't have a direct recipient lookup, we search in spendings
    // This might be slow if not optimized, but for now we iterate.
    // A better way would be to have a recipient map in structured data, but we work with what we have.
    // We look for spendings matching the name.
    const recipientSpendings = data.spendings.filter(s => s.spendingName === targetRecipientName);

    if (recipientSpendings.length === 0) {
      // It might be "その他" or aggregated, but usually we target specific named recipient
      // If not found, return empty
    } else {
      // In Spending View, "topSpendings" will contain just the target recipient (aggregated or single)
      // Actually, the recipient node is the root.
      // We need to find which projects paid to this recipient.

      // Aggregate all spending records for this recipient name (in case of multiple IDs for same name, though unlikely for unique ID)
      // Assuming targetRecipientName corresponds to a unique entity logic we want to show.
      topSpendings = recipientSpendings;

      // 2. Find Projects that paid to this recipient
      // We need to collect all project IDs from these spending records
      const contributingProjectIds = new Set<number>();
      const amountByProject = new Map<number, number>();

      for (const s of recipientSpendings) {
        for (const p of s.projects) {
          contributingProjectIds.add(p.projectId);
          const current = amountByProject.get(p.projectId) || 0;
          amountByProject.set(p.projectId, current + p.amount);
        }
      }

      // Get full project details
      const allContributingProjects = data.budgets.filter(b => contributingProjectIds.has(b.projectId));

      // Sort projects by amount contributed to this recipient
      const sortedProjects = allContributingProjects.sort((a, b) => {
        return (amountByProject.get(b.projectId) || 0) - (amountByProject.get(a.projectId) || 0);
      });

      // Take Top N Projects
      topProjects = sortedProjects.slice(0, projectLimit); // Use projectLimit for this view's TopN

      // 3. Find Ministries for these projects
      const ministryNames = new Set(topProjects.map(p => p.ministry));
      topMinistries = data.budgetTree.ministries
        .filter(m => ministryNames.has(m.name))
        .map(m => ({
          name: m.name,
          id: m.id,
          totalBudget: m.totalBudget,
          bureauCount: m.bureaus.length
        }));
    }

  } else if (targetProjectName) {
    // --- Project View ---
    // 1. Find Project
    const project = data.budgets.find(b => b.projectName === targetProjectName);
    if (!project) {
      throw new Error(`Project not found: ${targetProjectName}`);
    }
    topProjects = [project];

    // 2. Find Ministry
    const ministry = data.budgetTree.ministries.find(m => m.name === project.ministry);
    if (ministry) {
      topMinistries = [{
        name: ministry.name,
        id: ministry.id,
        totalBudget: ministry.totalBudget,
        bureauCount: ministry.bureaus.length,
      }];
    }

    // 3. Find Spendings for this project
    // Logic similar to standard view but focused on one project
    // We will populate topSpendings below using the standard logic but applied to this single project

  } else if (targetMinistryName) {
    // --- Ministry View ---
    const ministry = data.budgetTree.ministries.find(m => m.name === targetMinistryName);
    if (!ministry) {
      throw new Error(`Ministry not found: ${targetMinistryName}`);
    }
    topMinistries = [{
      name: ministry.name,
      id: ministry.id,
      totalBudget: ministry.totalBudget,
      bureauCount: ministry.bureaus.length,
    }];

    // Select Top Projects for this ministry
    const ministryProjects = data.budgets
      .filter(p => p.ministry === ministry.name)
      .sort((a, b) => b.totalBudget - a.totalBudget);

    topProjects = ministryProjects.slice(projectOffset, projectOffset + projectLimit);

    // Calculate other projects budget (remaining after the current page)
    const otherBudget = ministryProjects
      .slice(projectOffset + projectLimit)
      .reduce((sum, p) => sum + p.totalBudget, 0);
    if (otherBudget > 0) {
      otherProjectsBudgetByMinistry.set(ministry.name, otherBudget);
    }

    // Calculate spending amount for "Other Projects"
    const otherSpending = ministryProjects
      .slice(projectOffset + projectLimit)
      .reduce((sum, p) => sum + p.totalSpendingAmount, 0);
    if (otherSpending > 0) {
      otherProjectsSpendingByMinistry.set(ministry.name, otherSpending);
    }

  } else {
    // --- Global View (Recipient-First Approach) ---
    // 1. Select Top N Recipients (excluding "その他") based on spending amount
    const allRecipients = data.spendings
      .filter(s => s.spendingName !== 'その他')
      .sort((a, b) => b.totalSpendingAmount - a.totalSpendingAmount);

    const topRecipients = allRecipients.slice(offset, offset + spendingLimit);
    topSpendings = topRecipients;

    // 2. Find all projects that contribute to TopN recipients
    const topRecipientIds = new Set(topRecipients.map(r => r.spendingId));

    // Calculate each project's spending to top recipients
    const projectSpendingToTopRecipients = new Map<number, number>();
    for (const project of data.budgets) {
      let spendingToTop = 0;
      const projectSpendings = data.spendings.filter(s =>
        s.projects.some(p => p.projectId === project.projectId)
      );
      for (const spending of projectSpendings) {
        if (topRecipientIds.has(spending.spendingId)) {
          const projectContribution = spending.projects.find(p => p.projectId === project.projectId);
          if (projectContribution) {
            spendingToTop += projectContribution.amount;
          }
        }
      }
      if (spendingToTop > 0) {
        projectSpendingToTopRecipients.set(project.projectId, spendingToTop);
      }
    }

    // Select projects that contribute to TopN recipients, sorted by contribution
    // Limit to spendingLimit (or a reasonable number) to avoid too many project nodes
    const contributingProjects = data.budgets
      .filter(b => projectSpendingToTopRecipients.has(b.projectId))
      .sort((a, b) => {
        return (projectSpendingToTopRecipients.get(b.projectId) || 0) -
          (projectSpendingToTopRecipients.get(a.projectId) || 0);
      })
      .slice(0, spendingLimit); // Limit to Top N projects to match user expectation

    topProjects = contributingProjects;

    // 3. Select TopN ministries (not all ministries)
    const allMinistries = data.budgetTree.ministries
      .sort((a, b) => b.totalBudget - a.totalBudget);

    // Use 'limit' parameter for ministry selection (default: 3)
    topMinistries = allMinistries.slice(0, limit).map(m => ({
      name: m.name,
      id: m.id,
      totalBudget: m.totalBudget,
      bureauCount: m.bureaus.length,
    }));

    // Calculate "Other Ministries" budget and spending
    const otherMinistries = allMinistries.slice(limit);
    otherMinistriesBudget = otherMinistries.reduce((sum, m) => sum + m.totalBudget, 0);

    // Calculate other ministries spending
    for (const ministry of otherMinistries) {
      const ministryStats = data.statistics.byMinistry[ministry.name];
      if (ministryStats) {
        otherMinistriesSpending += ministryStats.totalSpending;
      }
    }

    // Calculate "Other Projects" for Global View to ensure flow continuity
    for (const ministry of topMinistries) {
      const ministryProjects = topProjects.filter(p => p.ministry === ministry.name);

      // Budget
      const usedBudget = ministryProjects.reduce((sum, p) => sum + p.totalBudget, 0);
      const otherBudget = ministry.totalBudget - usedBudget;
      if (otherBudget > 0) {
        otherProjectsBudgetByMinistry.set(ministry.name, otherBudget);
      }

      // Spending
      const ministryStats = data.statistics.byMinistry[ministry.name];
      const totalSpending = ministryStats ? ministryStats.totalSpending : 0;
      const usedSpending = ministryProjects.reduce((sum, p) => sum + p.totalSpendingAmount, 0);
      const otherSpending = totalSpending - usedSpending;

      if (otherSpending > 0) {
        otherProjectsSpendingByMinistry.set(ministry.name, otherSpending);
      }
    }
  }

  // --- Common Logic for Spendings (except for Spending View which is handled above) ---
  // In Global View, topSpendings is already selected globally.
  // In Ministry/Project View, we need to select top spendings per project.
  if (!targetRecipientName && (targetMinistryName || targetProjectName)) {
    // For Global View, topSpendings is already selected
    // For other views, we need to select top spendings per project

    // Aggregate "Other" named spendings
    for (const project of data.budgets) {
      // Optimization: Only process if project is in topProjects or if we need it for "Other" calculations
      // For simplicity, we might process all, but let's try to be efficient.
      // Actually, we only need otherNamedSpendingByProject for the selected projects to show the "Other" node correctly linked.
      // But wait, "Other Named" node aggregates from ALL projects? 
      // In the original logic: "otherNamedSpendingByProject" was calculated for ALL projects.
      // Let's keep it consistent.

      const projectSpendings = data.spendings
        .filter(s => project.spendingIds.includes(s.spendingId))
        .filter(s => s.spendingName === 'その他');

      const otherNamedTotal = projectSpendings.reduce((sum, s) => {
        const projectSpending = s.projects.find(p => p.projectId === project.projectId);
        return sum + (projectSpending?.amount || 0);
      }, 0);

      if (otherNamedTotal > 0) {
        otherNamedSpendingByProject.set(project.projectId, otherNamedTotal);
      }
    }

    // Select Top Spendings for selected projects
    const topSpendingIds = new Set<number>();

    for (const project of topProjects) {
      const projectSpendings = data.spendings
        .filter(s => project.spendingIds.includes(s.spendingId))
        .filter(s => s.spendingName !== 'その他')
        .map(s => {
          const projectSpending = s.projects.find(p => p.projectId === project.projectId);
          return {
            spending: s,
            amountFromThisProject: projectSpending?.amount || 0,
          };
        });

      const sortedSpendings = projectSpendings.sort((a, b) => b.amountFromThisProject - a.amountFromThisProject);
      const topNSpendings = sortedSpendings.slice(0, spendingLimit);

      for (const { spending } of topNSpendings) {
        topSpendingIds.add(spending.spendingId);
      }

      const otherSpendingTotal = sortedSpendings
        .slice(spendingLimit)
        .reduce((sum, { amountFromThisProject }) => sum + amountFromThisProject, 0);

      if (otherSpendingTotal > 0) {
        otherSpendingsByProject.set(project.projectId, otherSpendingTotal);
      }
    }

    topSpendings = data.spendings.filter(s => topSpendingIds.has(s.spendingId));
  }

  return {
    topMinistries,
    otherMinistriesBudget,
    otherMinistriesSpending,
    topProjects,
    otherProjectsBudgetByMinistry,
    otherProjectsSpendingByMinistry,
    topSpendings,
    otherSpendingsByProject,
    otherNamedSpendingByProject,
  };
}

function buildSankeyData(
  selection: DataSelection,
  fullData: RS2024StructuredData,
  options: {
    offset: number;
    targetMinistryName?: string;
    targetProjectName?: string;
    targetRecipientName?: string;
  }
): { nodes: SankeyNode[]; links: SankeyLink[] } {
  const {
    topMinistries,
    otherMinistriesBudget,
    otherMinistriesSpending,
    topProjects,
    otherProjectsBudgetByMinistry,
    otherProjectsSpendingByMinistry,
    topSpendings,
    otherSpendingsByProject,
    otherNamedSpendingByProject,
  } = selection;

  const { offset, targetMinistryName, targetProjectName, targetRecipientName } = options;

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];

  // --- SPENDING VIEW (Reverse Flow) ---
  if (targetRecipientName) {
    // Root: Recipient
    // We assume topSpendings contains the target recipient(s)
    // Actually, we should create a single root node for the target recipient
    const recipientNodeId = `recipient-root`;
    // Calculate total value from selected projects
    // Note: This might differ from totalSpendingAmount if we only selected TopN projects
    // But for the Sankey to balance, we should sum the links.

    // We need to calculate links first or sum up.
    // Let's iterate projects.

    let totalRecipientValue = 0;

    // Projects Column
    const projectNodes: SankeyNode[] = [];
    for (const project of topProjects) {
      // Find amount contributed by this project to the target recipient
      // We need to look up in data.spendings again or pass it from selectData
      // For simplicity, let's re-find.
      // In selectData we found recipientSpendings.
      // We can filter topSpendings (which are the recipient records)

      let amount = 0;
      for (const s of topSpendings) {
        const p = s.projects.find(p => p.projectId === project.projectId);
        if (p) amount += p.amount;
      }

      if (amount > 0) {
        totalRecipientValue += amount;

        projectNodes.push({
          id: `project-${project.projectId}`,
          name: project.projectName,
          type: 'project-budget', // Reusing type for color
          value: amount,
          originalId: project.projectId,
          details: {
            ministry: project.ministry,
            bureau: project.bureau,
            fiscalYear: project.fiscalYear,
            initialBudget: project.initialBudget,
            supplementaryBudget: project.supplementaryBudget,
            carryoverBudget: project.carryoverBudget,
            reserveFund: project.reserveFund,
            totalBudget: project.totalBudget,
            executedAmount: project.executedAmount,
            carryoverToNext: project.carryoverToNext,
            accountCategory: project.accountCategory,
          }
        });

        // Link: Project -> Recipient (reversed for left-to-right flow)
        links.push({
          source: `project-${project.projectId}`,
          target: recipientNodeId,
          value: amount
        });
      }
    }

    nodes.push({
      id: recipientNodeId,
      name: targetRecipientName,
      type: 'recipient',
      value: totalRecipientValue,
      details: {
        corporateNumber: '',
        location: '',
        projectCount: topProjects.length,
      }
    });

    nodes.push(...projectNodes);

    // Ministries Column
    const ministryNodes: SankeyNode[] = [];
    for (const ministry of topMinistries) {
      // Sum up projects for this ministry
      const ministryProjects = topProjects.filter(p => p.ministry === ministry.name);
      let ministryValue = 0;

      for (const p of ministryProjects) {
        // Find value for this project (already calculated above, but need to access it)
        // Let's re-calc or look at links.
        // Easier to re-calc.
        let pAmount = 0;
        for (const s of topSpendings) {
          const proj = s.projects.find(pr => pr.projectId === p.projectId);
          if (proj) pAmount += proj.amount;
        }
        ministryValue += pAmount;

        if (pAmount > 0) {
          // Link: Ministry -> Project (reversed for left-to-right flow)
          links.push({
            source: `ministry-${ministry.id}`,
            target: `project-${p.projectId}`,
            value: pAmount
          });
        }
      }

      if (ministryValue > 0) {
        ministryNodes.push({
          id: `ministry-${ministry.id}`,
          name: ministry.name,
          type: 'ministry-budget',
          value: ministryValue,
          originalId: ministry.id,
          details: {
            projectCount: ministryProjects.length,
            bureauCount: ministry.bureauCount
          }
        });
      }
    }
    nodes.push(...ministryNodes);

    return { nodes, links };
  }

  // --- STANDARD VIEWS (Global, Ministry, Project) ---

  // Determine view type early for conditional logic
  const isGlobalView = !targetMinistryName && !targetProjectName && !targetRecipientName;

  // Column 0: Total Budget
  // Shown in: Global View, Project View
  // Not shown in: Ministry View (targetMinistryName is set but not targetProjectName)
  if (!targetMinistryName || targetProjectName) {
    const totalBudget = topMinistries.reduce((sum, m) => sum + m.totalBudget, 0) + otherMinistriesBudget;
    const totalBudgetName = offset === 0 ? '予算総計' : `予算総計 (Rank ${offset + 1}+)`;

    nodes.push({
      id: 'total-budget',
      name: totalBudgetName,
      type: 'ministry-budget',
      value: totalBudget,
      details: {
        projectCount: topProjects.length,
        bureauCount: topMinistries.reduce((sum, m) => sum + m.bureauCount, 0),
      },
    });

    // Link: Total -> Ministry (Global View only)
    if (!targetMinistryName && !targetProjectName) {
      for (const ministry of topMinistries) {
        links.push({
          source: 'total-budget',
          target: `ministry-budget-${ministry.id}`,
          value: ministry.totalBudget,
        });
      }
      if (otherMinistriesBudget > 0) {
        links.push({
          source: 'total-budget',
          target: 'ministry-budget-other',
          value: otherMinistriesBudget,
        });
      }
    }
    // Note: In Project View, Total -> Project Budget links are created in the Project Budget section
  }

  // Column 1: Ministry Nodes (Not shown in Project View)
  const standardMinistryNodes: SankeyNode[] = [];

  // Skip ministry nodes in Project View to avoid 0-yen ghost nodes
  if (!targetProjectName) {
    for (const ministry of topMinistries) {
      const projectCount = topProjects.filter(p => p.ministry === ministry.name).length;

      // In Ministry View, use the sum of selected projects' budgets
      // In Global View, use ministry's total budget
      const ministryValue = targetMinistryName
        ? topProjects.filter(p => p.ministry === ministry.name).reduce((sum, p) => sum + p.totalBudget, 0)
        : ministry.totalBudget;

      standardMinistryNodes.push({
        id: `ministry-budget-${ministry.id}`,
        name: `${ministry.name}`,
        type: 'ministry-budget',
        value: ministryValue,
        originalId: ministry.id,
        details: {
          projectCount: projectCount,
          bureauCount: ministry.bureauCount,
        },
      });
    }

    // Add "Other Ministries" node if applicable (Global View only)
    if (isGlobalView && otherMinistriesBudget > 0) {
      standardMinistryNodes.push({
        id: 'ministry-budget-other',
        name: 'その他の府省庁',
        type: 'ministry-budget',
        value: otherMinistriesBudget,
        details: {
          projectCount: 0,
          bureauCount: 0,
        },
      });
    }

    nodes.push(...standardMinistryNodes);
  }

  // Column 2: Project Budget Nodes
  const projectBudgetNodes: SankeyNode[] = [];

  // Create budget nodes for all projects in topProjects
  for (const project of topProjects) {
    // Use dummy value 0.001 if budget is 0 but spending exists
    const budgetNodeValue = project.totalBudget === 0 && project.totalSpendingAmount > 0
      ? 0.001
      : project.totalBudget;

    projectBudgetNodes.push({
      id: `project-budget-${project.projectId}`,
      name: project.projectName,
      type: 'project-budget',
      value: budgetNodeValue,
      originalId: project.projectId,
      details: {
        ministry: project.ministry,
        bureau: project.bureau,
        fiscalYear: project.fiscalYear,
        initialBudget: project.initialBudget,
        supplementaryBudget: project.supplementaryBudget,
        carryoverBudget: project.carryoverBudget,
        reserveFund: project.reserveFund,
        totalBudget: project.totalBudget,
        executedAmount: project.executedAmount,
        carryoverToNext: project.carryoverToNext,
        accountCategory: project.accountCategory,
      },
    });

    // Link: Ministry -> Project Budget (Global & Ministry View only)
    // In Project View, Total Budget links directly to Project Budget
    if (!targetProjectName) {
      // Use dummy value 0.001 if budget is 0 but spending exists
      const linkValue = project.totalBudget === 0 && project.totalSpendingAmount > 0
        ? 0.001
        : project.totalBudget;

      // Find ministry ID from topMinistries or full data
      const ministry = topMinistries.find(m => m.name === project.ministry);
      if (ministry) {
        links.push({
          source: `ministry-budget-${ministry.id}`,
          target: `project-budget-${project.projectId}`,
          value: linkValue,
        });
      } else if (isGlobalView && otherMinistriesBudget > 0) {
        // In Global View, link projects from non-TopN ministries to "その他の府省庁"
        links.push({
          source: 'ministry-budget-other',
          target: `project-budget-${project.projectId}`,
          value: linkValue,
        });
      }
    } else {
      // Project View: Total Budget -> Project Budget
      const linkValue = project.totalBudget === 0 && project.totalSpendingAmount > 0
        ? 0.001
        : project.totalBudget;

      links.push({
        source: 'total-budget',
        target: `project-budget-${project.projectId}`,
        value: linkValue,
      });
    }
  }

  // Create "Other Projects" budget nodes (non-Global View only)
  if (!isGlobalView) {
    for (const ministry of topMinistries) {
      const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name);
      if (otherBudget && otherBudget > 0 && !targetProjectName) {
        projectBudgetNodes.push({
          id: `project-budget-other-${ministry.id}`,
          name: 'その他の事業',
          type: 'project-budget',
          value: otherBudget,
          details: {
            ministry: ministry.name,
            bureau: '',
            fiscalYear: 2024,
            initialBudget: otherBudget,
            supplementaryBudget: 0,
            carryoverBudget: 0,
            reserveFund: 0,
            totalBudget: otherBudget,
            executedAmount: 0,
            carryoverToNext: 0,
            accountCategory: '',
          },
        });

        links.push({
          source: `ministry-budget-${ministry.id}`,
          target: `project-budget-other-${ministry.id}`,
          value: otherBudget,
        });
      }
    }
  }

  // Global View: Create single "Other Projects" budget node and links
  if (isGlobalView) {
    let totalOtherBudget = 0;

    // Links from topMinistries to "Other Projects"
    for (const ministry of topMinistries) {
      const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name);
      if (otherBudget && otherBudget > 0) {
        totalOtherBudget += otherBudget;
        links.push({
          source: `ministry-budget-${ministry.id}`,
          target: 'project-budget-other-global',
          value: otherBudget,
        });
      }
    }

    // Link from "Other Ministries" to "Other Projects"
    if (otherMinistriesBudget > 0) {
      totalOtherBudget += otherMinistriesBudget;
      links.push({
        source: 'ministry-budget-other',
        target: 'project-budget-other-global',
        value: otherMinistriesBudget,
      });
    }

    if (totalOtherBudget > 0) {
      projectBudgetNodes.push({
        id: 'project-budget-other-global',
        name: 'その他の事業',
        type: 'project-budget',
        value: totalOtherBudget,
        details: {
          ministry: '全府省庁',
          bureau: '',
          fiscalYear: 2024,
          initialBudget: totalOtherBudget,
          supplementaryBudget: 0,
          carryoverBudget: 0,
          reserveFund: 0,
          totalBudget: totalOtherBudget,
          executedAmount: 0,
          carryoverToNext: 0,
          accountCategory: '',
        },
      });
    }
  }
  nodes.push(...projectBudgetNodes);

  // Column 3: Project Spending Nodes
  const projectSpendingNodes: SankeyNode[] = [];

  // Create spending nodes for all projects in topProjects
  for (const project of topProjects) {
    projectSpendingNodes.push({
      id: `project-spending-${project.projectId}`,
      name: project.projectName,
      type: 'project-spending',
      value: project.totalSpendingAmount,
      originalId: project.projectId,
      details: {
        ministry: project.ministry,
        bureau: project.bureau,
        fiscalYear: project.fiscalYear,
        executionRate: project.executionRate,
        spendingCount: project.spendingIds.length,
      },
    });

    // Use dummy value 0.001 if budget is 0 but spending exists
    let linkValue = Math.min(project.totalBudget, project.totalSpendingAmount);
    if (project.totalBudget === 0 && project.totalSpendingAmount > 0) {
      linkValue = 0.001;
    }

    links.push({
      source: `project-budget-${project.projectId}`,
      target: `project-spending-${project.projectId}`,
      value: linkValue,
    });
  }

  // Create "Other Projects" spending nodes (non-Global View only)
  if (!isGlobalView) {
    for (const ministry of topMinistries) {
      const otherSpending = otherProjectsSpendingByMinistry.get(ministry.name);
      const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name);
      if (otherSpending && otherSpending > 0 && !targetProjectName) {
        projectSpendingNodes.push({
          id: `project-spending-other-${ministry.id}`,
          name: 'その他の事業',
          type: 'project-spending',
          value: otherSpending,
          details: {
            ministry: ministry.name,
            bureau: '',
            fiscalYear: 2024,
            executionRate: 0,
            spendingCount: 0,
          },
        });

        // Link from budget-side to spending-side "Other Projects"
        const linkValue = Math.min(otherBudget || 0, otherSpending);
        if (linkValue > 0) {
          links.push({
            source: `project-budget-other-${ministry.id}`,
            target: `project-spending-other-${ministry.id}`,
            value: linkValue,
          });
        }
      }
    }
  }

  // Global View: Create single "Other Projects" spending node
  if (isGlobalView) {
    let totalOtherSpending = 0;
    let totalOtherBudget = 0; // Need this for link calculation

    // Aggregate from topMinistries
    for (const ministry of topMinistries) {
      const otherSpending = otherProjectsSpendingByMinistry.get(ministry.name);
      const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name);
      if (otherSpending) totalOtherSpending += otherSpending;
      if (otherBudget) totalOtherBudget += otherBudget;
    }

    // Add "Other Ministries" spending
    totalOtherSpending += otherMinistriesSpending;
    totalOtherBudget += otherMinistriesBudget;

    if (totalOtherSpending > 0) {
      projectSpendingNodes.push({
        id: 'project-spending-other-global',
        name: 'その他の事業',
        type: 'project-spending',
        value: totalOtherSpending,
        details: {
          ministry: '全府省庁',
          bureau: '',
          fiscalYear: 2024,
          executionRate: 0,
          spendingCount: 0,
        },
      });

      // Link from budget-side to spending-side "Other Projects"
      // In global view, we link the global nodes
      const linkValue = Math.min(totalOtherBudget, totalOtherSpending);
      if (linkValue > 0) {
        links.push({
          source: 'project-budget-other-global',
          target: 'project-spending-other-global',
          value: linkValue,
        });
      }
    }
  }
  nodes.push(...projectSpendingNodes);

  // Column 4: Recipient Nodes
  const recipientNodes: SankeyNode[] = [];

  if (isGlobalView) {
    // Global View: Create nodes for all topSpendings and links from their projects
    for (const spending of topSpendings) {
      // Create recipient node
      recipientNodes.push({
        id: `recipient-${spending.spendingId}`,
        name: spending.spendingName,
        type: 'recipient',
        value: spending.totalSpendingAmount,
        originalId: spending.spendingId,
        details: {
          corporateNumber: spending.corporateNumber,
          location: spending.location,
          projectCount: spending.projectCount,
        },
      });

      // Create links from all projects that contribute to this spending
      for (const spendingProject of spending.projects) {
        // Check if this project's spending node exists (i.e., it's in topProjects)
        const projectExists = topProjects.some(p => p.projectId === spendingProject.projectId);
        if (projectExists) {
          links.push({
            source: `project-spending-${spendingProject.projectId}`,
            target: `recipient-${spending.spendingId}`,
            value: spendingProject.amount,
            details: {
              contractMethod: spendingProject.contractMethod,
              blockName: spendingProject.blockName,
            },
          });
        }
      }
    }
  } else {
    // Ministry/Project View: Original logic (project-first)
    for (const project of topProjects) {
      for (const spending of topSpendings) {
        const spendingProject = spending.projects.find(p => p.projectId === project.projectId);
        if (spendingProject) {
          if (!recipientNodes.some(n => n.id === `recipient-${spending.spendingId}`)) {
            recipientNodes.push({
              id: `recipient-${spending.spendingId}`,
              name: spending.spendingName,
              type: 'recipient',
              value: spending.totalSpendingAmount,
              originalId: spending.spendingId,
              details: {
                corporateNumber: spending.corporateNumber,
                location: spending.location,
                projectCount: spending.projectCount,
              },
            });
          }

          links.push({
            source: `project-spending-${project.projectId}`,
            target: `recipient-${spending.spendingId}`,
            value: spendingProject.amount,
            details: {
              contractMethod: spendingProject.contractMethod,
              blockName: spendingProject.blockName,
            },
          });
        }
      }
    }
  }


  // "Other Named" (その他)
  let totalOtherNamedAmount = 0;
  for (const [, otherNamedAmount] of otherNamedSpendingByProject.entries()) {
    totalOtherNamedAmount += otherNamedAmount;
  }

  if (totalOtherNamedAmount > 0) {
    recipientNodes.push({
      id: 'recipient-other-named',
      name: 'その他',
      type: 'recipient',
      value: totalOtherNamedAmount,
      details: {
        corporateNumber: '',
        location: '',
        projectCount: 0,
      },
    });

    const topProjectIds = new Set(topProjects.map(p => p.projectId));
    for (const [projectId, otherNamedAmount] of otherNamedSpendingByProject.entries()) {
      if (otherNamedAmount > 0 && topProjectIds.has(projectId)) {
        links.push({
          source: `project-spending-${projectId}`,
          target: 'recipient-other-named',
          value: otherNamedAmount,
        });
      }
    }

    // Links from "Other Projects" to "Other Named" - only in Ministry/Project views, NOT in Global View
    if (!targetProjectName && !targetRecipientName && !isGlobalView) {
      const { byMinistryId: otherProjectsOtherNamedByMinistryId } =
        calculateOtherProjectsOtherNamedByMinistry(topMinistries, topProjects, otherNamedSpendingByProject, fullData);

      for (const [ministryId, amount] of otherProjectsOtherNamedByMinistryId.entries()) {
        links.push({
          source: `project-spending-other-${ministryId}`,
          target: 'recipient-other-named',
          value: amount,
        });
      }
    }
  }

  // Helper functions for calculating "Other" amounts
  function calculateOtherProjectsOtherNamedByMinistry(
    topMinistries: Array<{ name: string; id: number; totalBudget: number; bureauCount: number }>,
    topProjects: BudgetRecord[],
    otherNamedSpendingByProject: Map<number, number>,
    fullData: RS2024StructuredData
  ): { byMinistryId: Map<number, number>; byMinistryName: Map<string, number> } {
    const byMinistryId = new Map<number, number>();
    const byMinistryName = new Map<string, number>();

    for (const ministry of topMinistries) {
      const ministryProjects = topProjects.filter(p => p.ministry === ministry.name);
      const ministryProjectIds = new Set(ministryProjects.map(p => p.projectId));
      const allMinistryProjectIds = fullData.budgets
        .filter(b => b.ministry === ministry.name)
        .map(b => b.projectId);

      let otherProjectsOtherNamedAmount = 0;
      for (const projectId of allMinistryProjectIds) {
        if (!ministryProjectIds.has(projectId)) {
          const amount = otherNamedSpendingByProject.get(projectId);
          if (amount) {
            otherProjectsOtherNamedAmount += amount;
          }
        }
      }

      if (otherProjectsOtherNamedAmount > 0) {
        byMinistryId.set(ministry.id, otherProjectsOtherNamedAmount);
        byMinistryName.set(ministry.name, otherProjectsOtherNamedAmount);
      }
    }

    return { byMinistryId, byMinistryName };
  }

  function calculateOtherMinistriesOtherNamedCorrect(
    otherMinistryNames: Set<string>,
    otherNamedSpendingByProject: Map<number, number>,
    fullData: RS2024StructuredData
  ): number {
    let amount = 0;
    for (const [projectId, val] of otherNamedSpendingByProject.entries()) {
      const project = fullData.budgets.find(b => b.projectId === projectId);
      if (project && otherMinistryNames.has(project.ministry)) {
        amount += val;
      }
    }
    return amount;
  }

  // Aggregated "Other Recipient" Node (for TopN cutoff)
  let totalOtherRecipientAmount = 0;

  if (isGlobalView) {
    // --- Global View: Calculate "その他の支出先" ---
    // 1. Flow from "Other Projects" (Global Aggregated Node)
    // We assume all "Other Projects" spending goes to "Other Recipients"
    const otherProjectsSpendingNode = nodes.find(n => n.id === 'project-spending-other-global');
    if (otherProjectsSpendingNode) {
      totalOtherRecipientAmount += otherProjectsSpendingNode.value;
    }

    // 2. Flow from "Top Projects" remainder
    // Calculate total spending of Top Projects minus what went to Top Recipients
    const topRecipientIds = new Set(topSpendings.map(s => s.spendingId));

    for (const project of topProjects) {
      let projectTotalToOthers = 0;

      // Find all recipients for this project
      for (const spendingId of project.spendingIds) {
        const spending = fullData.spendings.find(s => s.spendingId === spendingId);
        if (!spending) continue;

        // Skip topN recipients and "その他"
        if (topRecipientIds.has(spendingId) || spending.spendingName === 'その他') continue;

        // This is an "other recipient"
        const spendingProject = spending.projects.find(p => p.projectId === project.projectId);
        if (spendingProject) {
          projectTotalToOthers += spendingProject.amount;
        }
      }

      if (projectTotalToOthers > 0) {
        totalOtherRecipientAmount += projectTotalToOthers;
        // Store for later linking
        otherSpendingsByProject.set(project.projectId, projectTotalToOthers);
      }
    }
  } else {
    // --- Ministry/Project/Spending Views: Original logic ---
    // Calculate amounts for "Other Projects" -> "Other Recipients"
    const otherProjectsOtherNamedByMinistryNameForRecipient =
      totalOtherNamedAmount > 0 && !targetProjectName && !targetRecipientName
        ? calculateOtherProjectsOtherNamedByMinistry(topMinistries, topProjects, otherNamedSpendingByProject, fullData).byMinistryName
        : new Map<string, number>();

    // Calculate total for "Other Recipients" node
    for (const ministry of topMinistries) {
      const otherBudget = otherProjectsBudgetByMinistry.get(ministry.name) || 0;
      const otherNamedAmount = otherProjectsOtherNamedByMinistryNameForRecipient.get(ministry.name) || 0;
      const adjustedBudget = otherBudget - otherNamedAmount;
      if (adjustedBudget > 0) {
        totalOtherRecipientAmount += adjustedBudget;
      }
    }

    // Calculate total "Other Recipients" amount from "Other Projects" only
    for (const [, otherAmount] of otherSpendingsByProject.entries()) {
      totalOtherRecipientAmount += otherAmount;
    }
  }

  if (totalOtherRecipientAmount > 0) {
    recipientNodes.push({
      id: 'recipient-other-aggregated',
      name: 'その他の支出先',
      type: 'recipient',
      value: totalOtherRecipientAmount,
      details: {
        corporateNumber: '',
        location: '',
        projectCount: 0,
      },
    });

    if (isGlobalView) {
      // --- Global View: Links ---

      const otherProjectsSpendingNode = nodes.find(n => n.id === 'project-spending-other-global');
      let otherProjectsValueUsed = 0;

      // 1. Links from "Other Projects" (Global) to Top Recipients
      // If Top Projects don't cover the full amount of a Top Recipient, the rest comes from "Other Projects"
      for (const recipient of topSpendings) {
        // Calculate how much this recipient got from Top Projects
        let receivedFromTopProjects = 0;
        for (const project of topProjects) {
          const p = recipient.projects.find(rp => rp.projectId === project.projectId);
          if (p) receivedFromTopProjects += p.amount;
        }

        const remainder = recipient.totalSpendingAmount - receivedFromTopProjects;
        if (remainder > 0 && otherProjectsSpendingNode) {
          links.push({
            source: 'project-spending-other-global',
            target: `recipient-${recipient.spendingId}`,
            value: remainder,
          });
          otherProjectsValueUsed += remainder;
        }
      }

      // 2. Link from "Other Projects" (Global) to "Other Recipients"
      // The remaining value of "Other Projects" goes to "Other Recipients"
      if (otherProjectsSpendingNode) {
        const remainingValue = otherProjectsSpendingNode.value - otherProjectsValueUsed;
        if (remainingValue > 0) {
          links.push({
            source: 'project-spending-other-global',
            target: 'recipient-other-aggregated',
            value: remainingValue,
          });
        }
      }

      // 3. Links from Top Projects to "Other Recipients"
      for (const [projectId, otherAmount] of otherSpendingsByProject.entries()) {
        if (otherAmount > 0) {
          links.push({
            source: `project-spending-${projectId}`,
            target: 'recipient-other-aggregated',
            value: otherAmount,
          });
        }
      }
    } else {
      // --- Ministry/Project/Spending Views: Original logic ---
      // Links from "Other Projects" to "Other Recipients"
      if (!targetProjectName && !targetRecipientName) {
        for (const ministry of topMinistries) {
          const otherSpending = otherProjectsSpendingByMinistry.get(ministry.name);
          if (otherSpending && otherSpending > 0) {
            links.push({
              source: `project-spending-other-${ministry.id}`,
              target: 'recipient-other-aggregated',
              value: otherSpending,
            });
          }
        }
      }

      // Links from selected projects to "Other Recipients"
      for (const [projectId, otherAmount] of otherSpendingsByProject.entries()) {
        if (otherAmount > 0) {
          links.push({
            source: `project-spending-${projectId}`,
            target: 'recipient-other-aggregated',
            value: otherAmount,
          });
        }
      }
    }
  }

  const regularRecipients = recipientNodes.filter(
    n => n.id !== 'recipient-other-aggregated' && n.id !== 'recipient-other-named'
  );
  const otherNamedRecipient = recipientNodes.filter(n => n.id === 'recipient-other-named');
  const aggregatedOther = recipientNodes.filter(n => n.id === 'recipient-other-aggregated');

  nodes.push(...regularRecipients, ...otherNamedRecipient, ...aggregatedOther);

  // Filter out nodes that have no links (0-yen ghost nodes)
  // A node must appear in at least one link (as source or target)
  const linkedNodeIds = new Set<string>();
  for (const link of links) {
    linkedNodeIds.add(link.source);
    linkedNodeIds.add(link.target);
  }

  const filteredNodes = nodes.filter(node => linkedNodeIds.has(node.id));

  // Also filter out links with 0 value
  const filteredLinks = links.filter(link => link.value > 0);

  return { nodes: filteredNodes, links: filteredLinks };
}
