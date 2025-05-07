import React, { ChangeEvent, FC, useCallback, useMemo, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { FaAngleDown, FaAngleUp, FaCheck } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@/components/Radix/DropdownMenu";
import { MetricTableItem } from "@/components/Metrics/MetricsList";
import { SyntaxFilter } from "@/services/search";

export const FilterMetricSearchModal: FC<{
  searchInputProps: {
    value: string;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  };
  syntaxFilters: SyntaxFilter[];
  combinedMetrics: MetricTableItem[];
  setSearchValue: (value: string) => void;
}> = ({ searchInputProps, syntaxFilters, combinedMetrics, setSearchValue }) => {
  const [dropdownFilterOpen, setDropdownFilterOpen] = useState("");
  const { datasources, projects } = useDefinitions();

  const availableTags = useMemo(() => {
    const availableTags: string[] = [];
    combinedMetrics.forEach((item) => {
      if (item.tags) {
        item.tags.forEach((tag) => {
          if (!availableTags.includes(tag)) {
            availableTags.push(tag);
          }
        });
      }
    });
    return availableTags;
  }, [combinedMetrics]);

  const doesFilterExist = useCallback(
    (
      field: string,
      value: string,
      operator?: string,
      negated?: boolean
    ): boolean => {
      if (negated !== undefined && operator !== undefined) {
        return syntaxFilters.some(
          (filter) =>
            filter.field === field &&
            filter.operator === operator &&
            filter.values.includes(value) &&
            filter.negated === negated
        );
      }
      if (operator !== undefined) {
        return syntaxFilters.some(
          (filter) =>
            filter.field === field &&
            filter.operator === operator &&
            filter.values.includes(value)
        );
      } else {
        return syntaxFilters.some(
          (filter) => filter.field === field && filter.values.includes(value)
        );
      }
    },
    [syntaxFilters]
  );

  const filterToString = useCallback((filter: SyntaxFilter) => {
    return (
      filter.field +
      ":" +
      (filter.negated ? "!" : "") +
      filter.operator +
      filter.values
        .map((v) => {
          return v.includes(" ") ? '"' + v + '"' : v;
        })
        .join(",")
    );
  }, []);

  const addFilterToSearch = useCallback(
    (filter: SyntaxFilter) => {
      const term = filterToString(filter);
      // set the search input value:
      setSearchValue(
        (searchInputProps.value.length > 0
          ? searchInputProps.value + " " + term
          : term
        ).trim()
      );
    },
    [filterToString, searchInputProps.value, setSearchValue]
  );

  const updateFilterToSearch = useCallback(
    (filter: SyntaxFilter) => {
      const term = filterToString(filter);
      const startsWith =
        filter.field + ":" + (filter.negated ? "!" : "") + filter.operator;
      // grab the value from the searchInputProps and replace the term:
      const newValue = searchInputProps.value.replace(
        new RegExp(`${startsWith}(?:"[^"]*"|[^\\s])*`, "g"),
        term
      );
      setSearchValue(newValue.trim());
    },
    [filterToString, searchInputProps, setSearchValue]
  );
  const removeFilterToSearch = useCallback(
    (filter: SyntaxFilter) => {
      const startsWith =
        filter.field + ":" + (filter.negated ? "!" : "") + filter.operator;
      // grab the value from the searchInputProps and replace the term:
      const newValue = searchInputProps.value.replace(
        new RegExp(`${startsWith}(?:"[^"]*"|[^\\s])*`, "g"),
        ""
      );
      setSearchValue(newValue.trim());
    },
    [searchInputProps.value, setSearchValue]
  );

  // updateQuery method which updates the URL query params
  const updateQuery = (filter: SyntaxFilter) => {
    const existingFilter = syntaxFilters.find(
      (f) =>
        f.field === filter.field &&
        f.operator === filter.operator &&
        f.negated === filter.negated
    );
    if (existingFilter) {
      // check to see if the value is already in the array:
      const valueExists = existingFilter.values.some(
        (v) => v === filter.values[0]
      );
      if (valueExists) {
        // remove it from the existing filter:
        existingFilter.values = existingFilter.values.filter(
          (v) => v !== filter.values[0]
        );
        // if there are no more values left, remove the filter set:
        if (existingFilter.values.length === 0) {
          removeFilterToSearch(existingFilter);
        } else {
          updateFilterToSearch(existingFilter);
        }
      } else {
        // add it to the existing filter:
        existingFilter.values = existingFilter.values.concat(filter.values);
        updateFilterToSearch(existingFilter);
      }
    } else {
      // add it
      addFilterToSearch(filter);
    }
  };

  // get a list of owners from the combined metrics:
  const owners = useMemo(() => {
    const owners = new Set<string>();
    combinedMetrics.forEach((m) => {
      if (m.owner) {
        owners.add(m.owner);
      }
    });
    return Array.from(owners);
  }, [combinedMetrics]);

  const hasArchivedMetrics = combinedMetrics.some((m) => m.archived);

  const metricTypes = [
    "ratio",
    "binomial",
    "proportion",
    "mean",
    "duration",
    "revenue",
    "count",
  ];

  return (
    <Flex gap="5" align="center">
      {/* search filters */}
      {/* datasource */}
      <DropdownMenu
        trigger={
          <IconButton
            variant="ghost"
            color="gray"
            radius="small"
            size="3"
            highContrast
          >
            <Flex gap="2" align="center">
              <Box>Datasource</Box>
              {dropdownFilterOpen === "datasource" ? (
                <FaAngleUp />
              ) : (
                <FaAngleDown />
              )}
            </Flex>
          </IconButton>
        }
        open={dropdownFilterOpen === "datasource"}
        onOpenChange={(o) => {
          setDropdownFilterOpen(o ? "datasource" : "");
        }}
      >
        {datasources.map((d) => (
          <DropdownMenuItem
            key={d.id}
            onClick={() => {
              const f: SyntaxFilter = {
                field: "datasource",
                values: [d.name],
                operator: "",
                negated: false,
              };
              console.log(f);
              updateQuery(f);
            }}
          >
            <Box className="position-relative">
              {doesFilterExist("datasource", d.name, "") ? (
                <Box
                  className="position-absolute"
                  style={{ left: "-2px", fontSize: "0.8rem" }}
                >
                  <FaCheck />{" "}
                </Box>
              ) : (
                ""
              )}
              <Box pl="4">{d.name}</Box>
            </Box>
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
      <DropdownMenu
        trigger={
          <IconButton
            variant="ghost"
            color="gray"
            radius="small"
            size="3"
            highContrast
          >
            <Flex gap="2" align="center">
              <Box>Projects</Box>
              {dropdownFilterOpen === "projects" ? (
                <FaAngleUp />
              ) : (
                <FaAngleDown />
              )}
            </Flex>
          </IconButton>
        }
        open={dropdownFilterOpen === "projects"}
        onOpenChange={(o) => {
          setDropdownFilterOpen(o ? "projects" : "");
        }}
      >
        {projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => {
              const f: SyntaxFilter = {
                field: "project",
                values: [p.name],
                operator: "",
                negated: false,
              };
              updateQuery(f);
            }}
          >
            <Box className="position-relative">
              {doesFilterExist("project", p.name, "") ? (
                <Box
                  className="position-absolute"
                  style={{ left: "-2px", fontSize: "0.8rem" }}
                >
                  <FaCheck />{" "}
                </Box>
              ) : (
                ""
              )}
              <Box pl="4">{p.name}</Box>
            </Box>
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
      <DropdownMenu
        trigger={
          <IconButton
            variant="ghost"
            color="gray"
            radius="small"
            size="3"
            highContrast
          >
            <Flex gap="2" align="center">
              <Box>Owner</Box>
              {dropdownFilterOpen === "owner" ? <FaAngleUp /> : <FaAngleDown />}
            </Flex>
          </IconButton>
        }
        open={dropdownFilterOpen === "owner"}
        onOpenChange={(o) => {
          setDropdownFilterOpen(o ? "owner" : "");
        }}
      >
        {owners.map((o) => (
          <DropdownMenuItem
            key={o}
            onClick={() => {
              const f: SyntaxFilter = {
                field: "owner",
                values: [o],
                operator: "",
                negated: false,
              };
              updateQuery(f);
            }}
          >
            <Box className="position-relative">
              {doesFilterExist("owner", o, "") ? (
                <Box
                  className="position-absolute"
                  style={{ left: "-2px", fontSize: "0.8rem" }}
                >
                  <FaCheck />{" "}
                </Box>
              ) : (
                ""
              )}
              <Box pl="4">{o}</Box>
            </Box>
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
      <DropdownMenu
        trigger={
          <IconButton
            variant="ghost"
            color="gray"
            radius="small"
            size="3"
            highContrast
          >
            <Flex gap="2" align="center">
              <Box>Tags</Box>
              {dropdownFilterOpen === "tags" ? <FaAngleUp /> : <FaAngleDown />}
            </Flex>
          </IconButton>
        }
        open={dropdownFilterOpen === "tags"}
        onOpenChange={(o) => {
          setDropdownFilterOpen(o ? "tags" : "");
        }}
      >
        {availableTags.map((t) => (
          <DropdownMenuItem
            key={t}
            onClick={() => {
              const f: SyntaxFilter = {
                field: "tag",
                values: [t],
                operator: "",
                negated: false,
              };
              updateQuery(f);
            }}
          >
            <Box className="position-relative">
              {doesFilterExist("tag", t, "") ? (
                <Box
                  className="position-absolute"
                  style={{ left: "-2px", fontSize: "0.8rem" }}
                >
                  <FaCheck />
                </Box>
              ) : (
                ""
              )}
              <Box pl="4">{t}</Box>
            </Box>
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
      <DropdownMenu
        trigger={
          <IconButton
            variant="ghost"
            color="gray"
            radius="small"
            size="3"
            highContrast
          >
            <Flex gap="2" align="center">
              <Box>Type</Box>
              {dropdownFilterOpen === "type" ? <FaAngleUp /> : <FaAngleDown />}
            </Flex>
          </IconButton>
        }
        open={dropdownFilterOpen === "type"}
        onOpenChange={(o) => {
          setDropdownFilterOpen(o ? "type" : "");
        }}
      >
        {metricTypes.map((t) => (
          <DropdownMenuItem
            key={t}
            onClick={() => {
              const f: SyntaxFilter = {
                field: "type",
                values: [t],
                operator: "",
                negated: false,
              };
              updateQuery(f);
            }}
          >
            <Box className="position-relative">
              {doesFilterExist("type", t, "") ? (
                <Box
                  className="position-absolute"
                  style={{ left: "-2px", fontSize: "0.8rem" }}
                >
                  <FaCheck />
                </Box>
              ) : (
                ""
              )}
              <Box pl="4">{t}</Box>
            </Box>
          </DropdownMenuItem>
        ))}
      </DropdownMenu>

      {/* TODO: Add date dropdown filters */}

      <DropdownMenu
        trigger={
          <IconButton
            variant="ghost"
            color="gray"
            radius="small"
            size="3"
            highContrast
          >
            <Flex gap="2" align="center">
              <Box>More</Box>
              {dropdownFilterOpen === "more" ? <FaAngleUp /> : <FaAngleDown />}
            </Flex>
          </IconButton>
        }
        open={dropdownFilterOpen === "more"}
        onOpenChange={(o) => {
          setDropdownFilterOpen(o ? "more" : "");
        }}
      >
        <DropdownMenuItem
          onClick={() => {
            const f: SyntaxFilter = {
              field: "is",
              values: ["official"],
              operator: "",
              negated: false,
            };
            updateQuery(f);
          }}
        >
          <Box className="position-relative">
            {doesFilterExist("is", "official", "") ? (
              <Box
                className="position-absolute"
                style={{ left: "-2px", fontSize: "0.8rem" }}
              >
                <FaCheck />{" "}
              </Box>
            ) : (
              ""
            )}
            <Box pl="4">Official metric</Box>
          </Box>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasArchivedMetrics}
          onClick={() => {
            const f: SyntaxFilter = {
              field: "is",
              values: ["archived"],
              operator: "",
              negated: false,
            };
            updateQuery(f);
          }}
        >
          <Box className="position-relative">
            {doesFilterExist("is", "archived", "") ? (
              <Box
                className="position-absolute"
                style={{ left: "-2px", fontSize: "0.8rem" }}
              >
                <FaCheck />{" "}
              </Box>
            ) : (
              ""
            )}
            <Box pl="4">Archived metric</Box>
          </Box>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            const f: SyntaxFilter = {
              field: "is",
              values: ["fact"],
              operator: "",
              negated: false,
            };
            updateQuery(f);
          }}
        >
          <Box className="position-relative">
            {doesFilterExist("is", "fact", "", false) ? (
              <Box
                className="position-absolute"
                style={{ left: "-2px", fontSize: "0.8rem" }}
              >
                <FaCheck />{" "}
              </Box>
            ) : (
              ""
            )}
            <Box pl="4">Fact metric</Box>
          </Box>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            const f: SyntaxFilter = {
              field: "is",
              values: ["fact"],
              operator: "",
              negated: true,
            };
            updateQuery(f);
          }}
        >
          <Box className="position-relative">
            {doesFilterExist("is", "fact", "", true) ? (
              <Box
                className="position-absolute"
                style={{ left: "-2px", fontSize: "0.8rem" }}
              >
                <FaCheck />{" "}
              </Box>
            ) : (
              ""
            )}
            <Box pl="4">Non-fact metric</Box>
          </Box>
        </DropdownMenuItem>
      </DropdownMenu>
    </Flex>
  );
};
